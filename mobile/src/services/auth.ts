/**
 * src/services/auth.ts - AWS Cognito authentication wrapper
 *
 * This module is a thin facade over @aws-amplify/auth v6.  All Cognito
 * API calls go through here so the rest of the app does not import
 * Amplify directly and the auth provider can be swapped without touching
 * screen components.
 *
 * Amplify v6 uses a modular API where each operation is a named function
 * imported from "@aws-amplify/auth".  The configuration (user pool ID,
 * client ID) is supplied once in App.tsx via Amplify.configure().
 *
 * Typical user flows supported:
 *   Sign In  → signIn(email, password)
 *   Sign Up  → signUp(email, password) → confirmSignUp(email, code)
 *   Sign Out → signOut()
 *   Session  → getCurrentUser()
 */

import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  signOut as amplifySignOut,
  getCurrentUser as amplifyGetCurrentUser,
  type SignInInput,
  type SignUpInput,
  type ConfirmSignUpInput,
} from '@aws-amplify/auth';

// ---------------------------------------------------------------------------
// Sign In
// ---------------------------------------------------------------------------

/**
 * Authenticate an existing Cognito user.
 * Amplify stores the resulting tokens (access, id, refresh) in
 * SecureStore (iOS Keychain / Android Keystore) automatically.
 *
 * @throws AuthError if credentials are wrong or the account is unconfirmed.
 */
export async function signIn(email: string, password: string): Promise<void> {
  const input: SignInInput = {
    username: email,
    password,
  };
  await amplifySignIn(input);
}

// ---------------------------------------------------------------------------
// Sign Up
// ---------------------------------------------------------------------------

/**
 * Register a new user in Cognito.
 * After this call, Cognito sends a verification code to the provided email.
 * Call confirmSignUp() with that code to activate the account.
 *
 * @throws AuthError if the email is already registered or the password
 *         does not meet the Cognito password policy.
 */
export async function signUp(email: string, password: string): Promise<void> {
  const input: SignUpInput = {
    username: email,
    password,
    // Cognito requires the email as an attribute for email-based sign-in
    options: {
      userAttributes: {
        email,
      },
    },
  };
  await amplifySignUp(input);
}

// ---------------------------------------------------------------------------
// Confirm Sign Up
// ---------------------------------------------------------------------------

/**
 * Confirm a new user account by submitting the verification code sent to
 * their email address.
 *
 * @param email - Must match the email used during signUp()
 * @param code  - 6-digit code from the Cognito verification email
 * @throws AuthError if the code is invalid or expired.
 */
export async function confirmSignUp(email: string, code: string): Promise<void> {
  const input: ConfirmSignUpInput = {
    username: email,
    confirmationCode: code,
  };
  await amplifyConfirmSignUp(input);
}

// ---------------------------------------------------------------------------
// Sign Out
// ---------------------------------------------------------------------------

/**
 * Sign the current user out and clear all stored tokens.
 * After this call, getCurrentUser() will return null.
 */
export async function signOut(): Promise<void> {
  await amplifySignOut();
}

// ---------------------------------------------------------------------------
// Get Current User
// ---------------------------------------------------------------------------

/**
 * Return basic info about the currently authenticated Cognito user,
 * or null if no session exists.
 *
 * Amplify v6's getCurrentUser() throws when there is no authenticated user
 * rather than returning null, so we catch that case here.
 */
export async function getCurrentUser(): Promise<{ email: string } | null> {
  try {
    const user = await amplifyGetCurrentUser();
    // amplifyGetCurrentUser() returns { userId, username, signInDetails }
    // The username is the Cognito username which, for email-based pools,
    // is the email address.
    return { email: user.username };
  } catch {
    // No active session
    return null;
  }
}
