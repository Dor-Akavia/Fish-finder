/**
 * app.js - Fish Finder Frontend (Authentication + Upload + Results)
 *
 * ═══════════════════════════════════════════════════════════════════
 * HOW COGNITO AUTHENTICATION WORKS (read this if you're new to it)
 * ═══════════════════════════════════════════════════════════════════
 *
 * AWS Cognito is a managed user directory. It handles sign-up, sign-in,
 * password policies, email verification, and token issuance — so we
 * don't have to build any of that ourselves.
 *
 * KEY CONCEPTS:
 *
 *   User Pool:    A directory of users (like a database of accounts).
 *                 Created by cognito.tf in Terraform. Identified by a
 *                 Pool ID like "eu-north-1_AbCdEf123".
 *
 *   App Client:   A "registration" of our app with the User Pool.
 *                 Each client gets a Client ID. Our webapp and mobile
 *                 app each have their own client.
 *
 *   JWT Tokens:   After sign-in, Cognito returns 3 tokens:
 *                   - ID Token:      Who the user is (email, name, etc.)
 *                                    → This is what we send to our Flask API
 *                   - Access Token:  What the user can do (scopes)
 *                   - Refresh Token: Used to get new ID/Access tokens
 *                                    without re-entering the password
 *
 *   SRP Protocol: The password is NEVER sent over the network in plain
 *                 text. The SDK uses the Secure Remote Password protocol
 *                 to prove the user knows the password without revealing it.
 *
 * THE FLOW:
 *
 *   1. Page loads → fetch /api/config to get Pool ID + Client ID
 *   2. Check if there's a valid session from a previous visit
 *      (tokens are stored in localStorage by the SDK automatically)
 *   3. If not authenticated → show Sign In form
 *   4. User signs in → SDK returns JWT tokens
 *   5. Every API call includes: Authorization: Bearer <id_token>
 *   6. Flask backend verifies the token against Cognito's public keys
 *   7. If the token expires (after 1 hour), the SDK silently refreshes
 *      it using the refresh token (valid 30 days)
 *
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 40;
const API_BASE = "";

// ─── Auth State ──────────────────────────────────────────────────────────────
//
// These three variables hold the Cognito auth state:
//   userPool    – the CognitoUserPool object (configured with Pool ID + Client ID)
//   cognitoUser – the CognitoUser object for the currently signed-in user (or null)
//   idToken     – the JWT ID token string to send with API calls (or null)
//
// The SDK stores tokens in localStorage under keys like:
//   CognitoIdentityServiceProvider.<client_id>.<email>.idToken
// This means the user stays logged in across page refreshes until the
// refresh token expires (30 days, configured in cognito.tf).
//
let userPool    = null;
let cognitoUser = null;
let idToken     = null;

// The email entered during sign-up, needed for the verification step
let pendingSignUpEmail = null;

// ─── DOM References ──────────────────────────────────────────────────────────

// Auth section
const authSection   = document.getElementById("auth-section");
const authTitle     = document.getElementById("auth-title");
const signinForm    = document.getElementById("signin-form");
const signupForm    = document.getElementById("signup-form");
const verifyForm    = document.getElementById("verify-form");
const authError     = document.getElementById("auth-error");
const authSpinner   = document.getElementById("auth-spinner");
const userBar       = document.getElementById("user-bar");
const userEmailEl   = document.getElementById("user-email");
const logoutBtn     = document.getElementById("logout-btn");

// Upload section
const dropZone         = document.getElementById("drop-zone");
const fileInput        = document.getElementById("file-input");
const previewContainer = document.getElementById("preview-container");
const previewImg       = document.getElementById("preview-img");
const previewName      = document.getElementById("preview-name");
const uploadBtn        = document.getElementById("upload-btn");
const cancelBtn        = document.getElementById("cancel-btn");

// State sections
const uploadSection    = document.getElementById("upload-section");
const statusSection    = document.getElementById("status-section");
const statusText       = document.getElementById("status-text");
const resultsSection   = document.getElementById("results-section");
const newUploadBtn     = document.getElementById("new-upload-btn");
const errorSection     = document.getElementById("error-section");
const errorText        = document.getElementById("error-text");
const retryBtn         = document.getElementById("retry-btn");

// ─── App State ───────────────────────────────────────────────────────────────
let selectedFile = null;
let pollTimer    = null;

// ═══════════════════════════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * On page load:
 *  1. Fetch the Cognito config from our Flask API (/api/config)
 *  2. Create the CognitoUserPool object
 *  3. Check if the user has an existing valid session (from a previous visit)
 *  4. If yes → skip straight to the upload screen
 *  5. If no  → show the sign-in form
 */
async function init() {
  console.log("[Fish Finder] Initialising...");

  try {
    // Step 1: Get the Cognito Pool ID and Client ID from our Flask backend.
    // We fetch these dynamically so they don't need to be hardcoded in the JS.
    // The /api/config endpoint is NOT protected by auth (chicken-and-egg).
    const configRes = await fetch(`${API_BASE}/api/config`);
    if (!configRes.ok) throw new Error("Failed to fetch /api/config");
    const cfg = await configRes.json();

    console.log(`[Fish Finder] Cognito Pool: ${cfg.pool_id}, Client: ${cfg.client_id}`);

    // Step 2: Create the User Pool object.
    // CognitoUserPool is the main entry point of the amazon-cognito-identity-js SDK.
    // It represents the user directory and knows how to talk to the Cognito API.
    userPool = new AmazonCognitoIdentity.CognitoUserPool({
      UserPoolId: cfg.pool_id,    // e.g. "eu-north-1_AbCdEf123"
      ClientId:   cfg.client_id,  // e.g. "1abc2def3ghi4jkl5"
    });

    // Step 3: Check for an existing session.
    // getCurrentUser() returns the last signed-in CognitoUser if there's
    // a valid refresh token in localStorage. Returns null otherwise.
    const currentUser = userPool.getCurrentUser();
    if (currentUser) {
      // getSession() validates the tokens and refreshes them if expired.
      // This is an async operation because it may need to call Cognito.
      currentUser.getSession((err, session) => {
        if (err || !session || !session.isValid()) {
          // Session is expired or corrupt — show sign-in form
          console.log("[Auth] No valid session found, showing sign-in form.");
          showAuthForm("signin");
          return;
        }
        // Session is valid — extract the JWT and go straight to the app
        console.log("[Auth] Valid session found, skipping sign-in.");
        cognitoUser = currentUser;
        idToken = session.getIdToken().getJwtToken();
        onAuthSuccess(currentUser.getUsername());
      });
    } else {
      showAuthForm("signin");
    }

  } catch (err) {
    console.error("[Fish Finder] Init error:", err);
    showAuthError("שגיאה בטעינת הגדרות. נסה לרענן את הדף.");
  }
}

// Start initialisation when the page loads
init();

// ═══════════════════════════════════════════════════════════════════════════
// AUTH UI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Show one of the three auth forms: "signin", "signup", or "verify".
 * Hides the other two and updates the title.
 */
function showAuthForm(form) {
  authSection.hidden = false;
  signinForm.hidden  = form !== "signin";
  signupForm.hidden  = form !== "signup";
  verifyForm.hidden  = form !== "verify";
  authError.hidden   = true;
  authSpinner.hidden = true;

  const titles = { signin: "התחברות", signup: "הרשמה", verify: "אימות אימייל" };
  authTitle.textContent = titles[form] || "";
}

/** Toggle to sign-up form */
document.getElementById("show-signup").addEventListener("click", (e) => {
  e.preventDefault();
  showAuthForm("signup");
});

/** Toggle to sign-in form */
document.getElementById("show-signin").addEventListener("click", (e) => {
  e.preventDefault();
  showAuthForm("signin");
});

function showAuthError(msg) {
  authError.textContent = msg;
  authError.hidden = false;
  authSpinner.hidden = true;
}

function showAuthLoading() {
  authError.hidden = true;
  authSpinner.hidden = false;
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGN IN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sign In Flow:
 *
 *   1. User enters email + password
 *   2. We create an AuthenticationDetails object (wraps the credentials)
 *   3. We create a CognitoUser object (represents this specific user)
 *   4. We call authenticateUser() which:
 *      a. Sends a SRP_A value to Cognito (part of the SRP protocol)
 *      b. Cognito responds with a challenge (SRP_B + salt)
 *      c. The SDK computes a proof using the password + challenge
 *      d. Cognito verifies the proof and returns JWT tokens
 *   5. On success → we extract the ID token and enter the app
 *
 *   The password NEVER leaves the browser in plain text.
 *   This is why SRP is used instead of just posting the password.
 */
signinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const email    = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;

  if (!email || !password) return;
  showAuthLoading();

  // AuthenticationDetails holds the username (email) and password.
  // The SDK will use these internally for the SRP handshake.
  const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({
    Username: email,
    Password: password,
  });

  // CognitoUser represents a single user in the pool.
  // We need to create one for every sign-in attempt.
  cognitoUser = new AmazonCognitoIdentity.CognitoUser({
    Username: email,
    Pool: userPool,
  });

  // authenticateUser() performs the full SRP handshake with Cognito.
  // The callbacks handle the result:
  cognitoUser.authenticateUser(authDetails, {
    // SUCCESS: Cognito verified the password and returned JWT tokens
    onSuccess: (session) => {
      console.log("[Auth] Sign-in successful!");
      // session.getIdToken().getJwtToken() returns the JWT string
      // that we send to our Flask API as: Authorization: Bearer <token>
      idToken = session.getIdToken().getJwtToken();
      onAuthSuccess(email);
    },

    // FAILURE: Wrong password, user not found, or user not confirmed
    onFailure: (err) => {
      console.error("[Auth] Sign-in failed:", err);

      // Translate common Cognito error codes to Hebrew for the user
      const messages = {
        "NotAuthorizedException":     "אימייל או סיסמה שגויים.",
        "UserNotFoundException":      "משתמש לא נמצא. נסה להרשם.",
        "UserNotConfirmedException":  "החשבון לא אומת. בדוק את האימייל שלך.",
      };
      showAuthError(messages[err.code] || err.message || "שגיאה בהתחברות.");
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SIGN UP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sign Up Flow:
 *
 *   1. User enters email + password
 *   2. We call userPool.signUp() with the email as an attribute
 *   3. Cognito creates the user in the User Pool (status: UNCONFIRMED)
 *   4. Cognito sends a 6-digit verification code to the email
 *   5. We show the Verify form so the user can enter the code
 *   6. The user enters the code → we call confirmRegistration()
 *   7. On success → the user's status becomes CONFIRMED
 *   8. The user can now sign in normally
 *
 *   Password requirements (configured in cognito.tf):
 *     - Minimum 8 characters
 *     - At least one uppercase letter
 *     - At least one lowercase letter
 *     - At least one number
 */
signupForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const email    = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  if (!email || !password) return;
  showAuthLoading();

  // Save email for the verification step (we need it to create
  // the CognitoUser object when calling confirmRegistration)
  pendingSignUpEmail = email;

  // The 'email' attribute tells Cognito to use this as the user's email.
  // This is required because our User Pool uses email as the username
  // (configured with username_attributes = ["email"] in cognito.tf).
  const attributeList = [
    new AmazonCognitoIdentity.CognitoUserAttribute({
      Name: "email",
      Value: email,
    }),
  ];

  // signUp() creates the user account in Cognito.
  // Cognito will send a verification email with a 6-digit code.
  userPool.signUp(email, password, attributeList, null, (err, result) => {
    if (err) {
      console.error("[Auth] Sign-up failed:", err);

      const messages = {
        "UsernameExistsException":       "כתובת האימייל הזו כבר רשומה.",
        "InvalidPasswordException":      "הסיסמה חלשה מדי. נדרשים: 8+ תווים, אות גדולה, אות קטנה, ומספר.",
        "InvalidParameterException":     "כתובת אימייל לא תקינה.",
      };
      showAuthError(messages[err.code] || err.message || "שגיאה בהרשמה.");
      return;
    }

    // Success — the user exists but is UNCONFIRMED until they enter the code
    console.log("[Auth] Sign-up successful, verification code sent to:", email);
    showAuthForm("verify");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * After sign-up, the user receives a 6-digit code by email.
 * They enter it here to confirm their account.
 *
 * confirmRegistration() tells Cognito that the user has access to
 * the email address they signed up with. This is a one-time process.
 */
verifyForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = document.getElementById("verify-code").value.trim();

  if (!code || !pendingSignUpEmail) return;
  showAuthLoading();

  // Create a CognitoUser for the pending email
  const user = new AmazonCognitoIdentity.CognitoUser({
    Username: pendingSignUpEmail,
    Pool: userPool,
  });

  // confirmRegistration() sends the code to Cognito for validation.
  // If the code matches, the user's status changes to CONFIRMED.
  user.confirmRegistration(code, true, (err, result) => {
    if (err) {
      console.error("[Auth] Verification failed:", err);
      showAuthError(err.code === "CodeMismatchException"
        ? "הקוד שגוי. בדוק שוב את האימייל."
        : err.message || "שגיאה באימות.");
      return;
    }

    // Account confirmed! Show sign-in form so they can log in
    console.log("[Auth] Account verified successfully!");
    pendingSignUpEmail = null;
    showAuthForm("signin");
    // Show a success message (reuse the error element with a different style)
    authError.textContent = "החשבון אומת בהצלחה! התחבר כדי להמשיך.";
    authError.hidden = false;
    authError.classList.add("auth-success");
    setTimeout(() => authError.classList.remove("auth-success"), 5000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST-AUTH: TRANSITION TO THE APP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Called after successful sign-in (or session restore).
 * Hides the auth section and shows the upload UI.
 */
function onAuthSuccess(email) {
  console.log(`[Auth] Authenticated as: ${email}`);

  // Hide auth, show upload
  authSection.hidden = true;
  showState("upload");

  // Show user info bar in the header
  userEmailEl.textContent = email;
  userBar.hidden = false;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sign out: clears the local session (tokens in localStorage).
 * The next page load will show the sign-in form.
 *
 * signOut() is a LOCAL operation — it only removes tokens from the browser.
 * It does NOT invalidate the refresh token on Cognito's side.
 * For a full server-side sign-out, use globalSignOut() instead.
 */
logoutBtn.addEventListener("click", () => {
  if (cognitoUser) {
    cognitoUser.signOut();
  }
  cognitoUser = null;
  idToken     = null;

  // Reset the UI back to the sign-in form
  userBar.hidden = true;
  showAuthForm("signin");
  uploadSection.hidden  = true;
  statusSection.hidden  = true;
  resultsSection.hidden = true;
  errorSection.hidden   = true;

  console.log("[Auth] Signed out.");
});

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN HELPER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns a fresh ID token, refreshing it if expired.
 *
 * JWT ID tokens expire after 1 hour (configured in cognito.tf:
 *   access_token_validity = 1 hour).
 *
 * The SDK's getSession() automatically uses the refresh token to get
 * a new ID token if the current one is expired. The refresh token itself
 * is valid for 30 days, so the user doesn't need to re-enter their password
 * for up to 30 days.
 *
 * Returns null if the session is completely invalid (refresh token expired).
 */
function getIdToken() {
  return new Promise((resolve) => {
    if (!cognitoUser) return resolve(null);

    cognitoUser.getSession((err, session) => {
      if (err || !session || !session.isValid()) {
        console.warn("[Auth] Session invalid, user needs to sign in again.");
        resolve(null);
        return;
      }
      // Update the stored token (it may have been refreshed)
      idToken = session.getIdToken().getJwtToken();
      resolve(idToken);
    });
  });
}

/**
 * Wrapper around fetch() that automatically attaches the Cognito JWT.
 * Use this for all /api/* calls instead of raw fetch().
 *
 * What it does:
 *   1. Calls getIdToken() to ensure the token is fresh
 *   2. Adds the Authorization header: "Bearer <jwt_token>"
 *   3. Makes the fetch request
 *   4. If the server returns 401 (token rejected), signs out
 *
 * This is the exact same pattern the mobile app will use (just with
 * a different HTTP library like URLSession on iOS or Retrofit on Android).
 */
async function authFetch(url, options = {}) {
  const token = await getIdToken();
  if (!token) {
    // Session expired — force sign-in
    logoutBtn.click();
    throw new Error("Session expired. Please sign in again.");
  }

  // Merge the Authorization header into whatever headers were passed
  const headers = options.headers || {};
  headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });

  // If the backend rejects the token (expired, tampered), sign out
  if (res.status === 401) {
    console.warn("[Auth] Server rejected token, signing out.");
    logoutBtn.click();
    throw new Error("Session expired. Please sign in again.");
  }

  return res;
}

// ═══════════════════════════════════════════════════════════════════════════
// UI STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════

function showState(state) {
  uploadSection .hidden = state !== "upload";
  statusSection .hidden = state !== "status";
  resultsSection.hidden = state !== "results";
  errorSection  .hidden = state !== "error";
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE SELECTION (unchanged from before)
// ═══════════════════════════════════════════════════════════════════════════

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) handleFileSelected(fileInput.files[0]);
});

dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); dropZone.classList.add("dragging"); });
dropZone.addEventListener("dragleave", ()  => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragging");
  if (e.dataTransfer.files.length > 0) handleFileSelected(e.dataTransfer.files[0]);
});

function handleFileSelected(file) {
  console.log(`[Fish Finder] File selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  selectedFile = file;
  previewImg.src = URL.createObjectURL(file);
  previewName.textContent = file.name;
  previewContainer.hidden = false;
  dropZone.hidden = true;
  fileInput.value = "";
}

cancelBtn.addEventListener("click", resetToUpload);

function resetToUpload() {
  selectedFile = null;
  previewContainer.hidden = true;
  dropZone.hidden = false;
  previewImg.src = "";
  showState("upload");
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// UPLOAD & IDENTIFY — now uses authFetch() instead of raw fetch()
// ═══════════════════════════════════════════════════════════════════════════

uploadBtn.addEventListener("click", startIdentification);
newUploadBtn.addEventListener("click", resetToUpload);
retryBtn.addEventListener("click", resetToUpload);

async function startIdentification() {
  if (!selectedFile) return;

  showState("status");
  setStatus("מבקש קישור העלאה...");

  try {
    // Step 1: Get presigned URL (now authenticated via authFetch)
    console.log("[Fish Finder] Requesting presigned upload URL...");
    const urlRes = await authFetch(`${API_BASE}/api/upload-url?filename=${encodeURIComponent(selectedFile.name)}`);
    if (!urlRes.ok) throw new Error(`Failed to get upload URL (HTTP ${urlRes.status})`);

    const { image_id, upload_url, fields } = await urlRes.json();
    console.log(`[Fish Finder] Got image_id: ${image_id}`);

    // Step 2: Upload directly to S3 (presigned URL — no auth header needed here,
    // the presigned fields contain the authorization)
    setStatus("מעלה תמונה ל-S3...");
    const formData = new FormData();
    Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
    formData.append("file", selectedFile);

    const uploadRes = await fetch(upload_url, { method: "POST", body: formData });
    if (!uploadRes.ok) throw new Error(`S3 upload failed (HTTP ${uploadRes.status})`);
    console.log("[Fish Finder] Upload to S3 successful.");

    // Step 3: Poll for ML results (authenticated)
    setStatus("מזהה דג... (עד 2 דקות)");
    await pollForResults(image_id);

  } catch (err) {
    console.error("[Fish Finder] Error:", err);
    showError(err.message || "אירעה שגיאה לא ידועה.");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POLLING — uses authFetch()
// ═══════════════════════════════════════════════════════════════════════════

function pollForResults(image_id) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    pollTimer = setInterval(async () => {
      attempts++;
      console.log(`[Fish Finder] Poll attempt ${attempts}/${POLL_MAX_ATTEMPTS}...`);

      try {
        // authFetch attaches the JWT automatically
        const res = await authFetch(`${API_BASE}/api/results/${image_id}`);
        if (!res.ok) throw new Error(`Results API error (HTTP ${res.status})`);

        const data = await res.json();

        if (data.status === "ready") {
          clearInterval(pollTimer);
          pollTimer = null;
          displayResults(data);
          resolve();
        } else if (attempts >= POLL_MAX_ATTEMPTS) {
          clearInterval(pollTimer);
          pollTimer = null;
          reject(new Error("הזמן הקצוב עבר. ה-Worker לא הגיב. בדוק שה-EC2 פועל."));
        }
      } catch (err) {
        clearInterval(pollTimer);
        pollTimer = null;
        reject(err);
      }
    }, POLL_INTERVAL_MS);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// DISPLAY RESULTS (unchanged)
// ═══════════════════════════════════════════════════════════════════════════

function displayResults(data) {
  console.log("[Fish Finder] Displaying results:", data);

  document.getElementById("result-hebrew").textContent      = data.hebrew_name;
  document.getElementById("result-species").textContent     = data.species;
  document.getElementById("result-native").textContent      = data.native;
  document.getElementById("result-population").textContent  = data.population;
  document.getElementById("result-avg-size").textContent    = `${data.avg_size_cm} ס״מ`;
  document.getElementById("result-min-size").textContent    = data.min_size_cm ? `${data.min_size_cm} ס״מ` : "אין גודל מינימלי";
  document.getElementById("result-notes").textContent       = data.notes;
  document.getElementById("result-description").textContent = data.description;

  const banEl = document.getElementById("result-ban");
  if (data.seasonal_ban) {
    banEl.textContent = "כן";
    banEl.className   = "value ban-yes";
  } else {
    banEl.textContent = "לא";
    banEl.className   = "value ban-no";
  }

  showState("results");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setStatus(message) {
  statusText.textContent = message;
}

function showError(message) {
  errorText.textContent = message;
  showState("error");
}
