# Mobile App - Testing, Deployment & Store Release Guide

> **Status: Planned / Not Yet Active**
> This guide is prepared for when the mobile app development resumes. The web app is the current production interface.

This guide walks through every step from local testing to published app on Google Play and Apple App Store.

For initial setup (installing dependencies, Cognito config, API URL), see [mobile-setup.md](mobile-setup.md).

---

## Table of Contents

1. [Local Testing](#1-local-testing)
2. [Device Testing with Expo Go](#2-device-testing-with-expo-go)
3. [Preview Builds (Internal Testing)](#3-preview-builds-internal-testing)
4. [Production Builds](#4-production-builds)
5. [Google Play Store Release](#5-google-play-store-release)
6. [Apple App Store Release](#6-apple-app-store-release)
7. [Post-Release Updates (OTA)](#7-post-release-updates-ota)
8. [Checklist Summary](#8-checklist-summary)

---

## 1. Local Testing

### Emulator / Simulator

```bash
cd mobile/

# Install dependencies (first time only)
npm install

# Start the Expo dev server
npm start

# Press 'a' for Android Emulator  (requires Android Studio)
# Press 'i' for iOS Simulator      (requires Xcode, macOS only)
```

### What to test locally

- **Auth flow:** Sign up, verify email, sign in, sign out
- **Camera/Gallery:** Take a photo or pick from library
- **Upload flow:** Image uploads to S3, progress indicator shows, result appears
- **Result display:** Hebrew names, regulations, confidence display correctly
- **Edge cases:** No network, invalid photo format, expired token (auto re-login)
- **RTL layout:** Hebrew text renders right-to-left correctly

### TypeScript check

```bash
npm run tsc
```

Fix any type errors before proceeding to builds.

---

## 2. Device Testing with Expo Go

The fastest way to test on a real phone without building a native binary.

1. Install **Expo Go** from the App Store (iOS) or Google Play (Android).
2. Run `npm start` in the `mobile/` directory.
3. Scan the QR code printed in the terminal:
   - **iOS:** Use the built-in Camera app
   - **Android:** Use the Expo Go app's QR scanner
4. The app loads directly on your phone via the Expo Go wrapper.

**Limitations of Expo Go:**
- Uses Expo Go's bundle ID, not `com.fishfinder.app`
- Cannot test push notifications or deep links
- Some native modules may behave differently in production builds

When you're satisfied with Expo Go testing, move to preview builds.

---

## 3. Preview Builds (Internal Testing)

Preview builds create a real native binary (.apk / .app) that you install directly on test devices. This tests the actual app without store submission.

### One-time setup: Install and configure EAS

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Log in to your Expo account (create one at https://expo.dev if needed)
eas login

# Initialise EAS in the project (creates eas.json)
cd mobile/
eas build:configure
```

This creates `eas.json` with three profiles: `development`, `preview`, `production`. Edit it to look like:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "ios": {
        "simulator": false
      }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@email.com",
        "ascAppId": "YOUR_APP_STORE_CONNECT_APP_ID"
      },
      "android": {
        "serviceAccountKeyPath": "./google-play-service-account.json"
      }
    }
  }
}
```

### Build preview binaries

```bash
# Android preview (.apk - install directly on any Android device)
eas build --platform android --profile preview

# iOS preview (requires Apple Developer account for ad-hoc provisioning)
eas build --platform ios --profile preview
```

EAS builds in the cloud (5-15 min). When done, you get a download link.

### Install on test devices

**Android:**
- Open the EAS download link on the Android device
- Tap "Install" (enable "Install unknown apps" if prompted)

**iOS:**
- Register test device UDIDs in your Apple Developer account first
- Open the EAS download link on the iOS device
- Go to Settings > General > VPN & Device Management to trust the profile

### What to test in preview builds

Everything from local testing, plus:
- **Camera permissions:** The native permission dialog appears with your custom message
- **App icon and splash screen:** Renders correctly
- **Background/foreground lifecycle:** App resumes correctly after backgrounding
- **Token persistence:** Close and reopen the app - should stay logged in

---

## 4. Production Builds

Production builds are optimised, signed binaries ready for store submission.

### Before building - Pre-flight checklist

1. **Update version numbers** in `app.json`:
   ```json
   "version": "1.0.0"     // User-facing version (shown in store listing)
   ```
   EAS auto-increments the build number if `"autoIncrement": true` is set.

2. **Verify bundle identifiers** match your developer accounts:
   ```json
   "ios": { "bundleIdentifier": "com.fishfinder.app" }
   "android": { "package": "com.fishfinder.app" }
   ```

3. **Point API URL to production** (CloudFront, not localhost):
   ```bash
   cd ../infrastracture/
   terraform output cloudfront_url
   ```
   Update `src/services/api.ts` with the CloudFront URL.

4. **Verify Cognito config** uses the mobile client ID:
   ```bash
   terraform output cognito_mobile_client_id
   ```

### Build

```bash
cd mobile/

# Android (.aab for Google Play)
eas build --platform android --profile production

# iOS (.ipa for App Store)
eas build --platform ios --profile production

# Both at once
eas build --platform all --profile production
```

**iOS notes:** EAS will prompt for your Apple Developer credentials and automatically manage signing certificates and provisioning profiles. If this is your first build, it creates a distribution certificate for you.

**Android notes:** EAS generates and stores the Android keystore for you. This keystore is critical - if lost, you cannot update your app. EAS manages it securely, but you can also download a backup from the EAS dashboard.

---

## 5. Google Play Store Release

### Prerequisites

| Item | Details |
|------|---------|
| Google Play Developer account | [$25 one-time fee](https://play.google.com/console/) |
| Privacy policy URL | Required - host a simple page explaining data use |
| App screenshots | At least 2 phone screenshots (min 320px, max 3840px) |
| Feature graphic | 1024x500px banner image |
| App description | Short (80 chars) + full description |

### Step-by-step

#### A. Create the app in Google Play Console

1. Go to [Google Play Console](https://play.google.com/console/)
2. Click "Create app"
3. Fill in: App name ("Fish Finder"), Default language (Hebrew or English), App type (App), Free/Paid
4. Accept the declarations

#### B. Complete the store listing

1. **Main store listing:** Title, short description, full description
2. **Graphics:** Upload screenshots (phone), feature graphic, app icon (512x512)
3. **Categorization:** Category = "Tools" or "Education", Tags = "fishing", "fish identification"

#### C. Content rating questionnaire

1. Go to "Content rating" in the sidebar
2. Fill the IARC questionnaire (the app has no violence, gambling, etc.)
3. Typical result: "Rated for everyone"

#### D. Data safety form

1. Go to "Data safety"
2. Declare: Camera access (fish photos), email (authentication), no data sharing with third parties
3. Mention photos are processed server-side and not stored permanently

#### E. Set up a service account for automated submissions (optional but recommended)

1. In Google Play Console: Setup > API access > Link to a Google Cloud project
2. Create a service account with "Release manager" permission
3. Download the JSON key and save as `mobile/google-play-service-account.json`
4. Add to `.gitignore`:
   ```
   google-play-service-account.json
   ```

#### F. Upload the .aab and submit

**Option 1 - EAS Submit (automated):**
```bash
eas submit --platform android --profile production
```
EAS will prompt for the service account key path if not configured in `eas.json`.

**Option 2 - Manual upload:**
1. Download the `.aab` from the EAS build dashboard
2. In Google Play Console: Testing > Internal testing > Create new release
3. Upload the `.aab`
4. Start internal testing first (you + testers), then promote to production

#### G. Review timeline

- **Internal testing:** Available immediately (up to 100 testers via email)
- **Closed testing:** Available within hours (invite testers or use a link)
- **Production:** First submission review takes 1-7 days. Updates are typically reviewed within hours.

---

## 6. Apple App Store Release

### Prerequisites

| Item | Details |
|------|---------|
| Apple Developer Program | [$99/year](https://developer.apple.com/programs/) |
| Mac | Not required for building (EAS builds in cloud), but helpful for Xcode testing |
| Privacy policy URL | Required |
| App screenshots | iPhone 6.7" and 5.5" sizes minimum |
| App description | Full description + keywords + support URL |

### Step-by-step

#### A. Create the app in App Store Connect

1. Go to [App Store Connect](https://appstoreconnect.apple.com/)
2. Click "+" > "New App"
3. Fill in: Platform (iOS), Name ("Fish Finder"), Primary language, Bundle ID (`com.fishfinder.app`), SKU (e.g., "fishfinder001")

#### B. Complete the app information

1. **Version Information:**
   - Screenshots for iPhone 6.7" (required) and 5.5" (required)
   - App description, keywords, support URL, marketing URL (optional)
   - "What's New" text for updates

2. **App Privacy:**
   - Data linked to user: Email address (authentication)
   - Data not linked to user: Photos (fish identification)
   - Data not collected: No tracking, no analytics (unless you add it later)

3. **App Review Information:**
   - Provide a demo account email + password if auth is required
   - In review notes, explain: "This app identifies Mediterranean fish species for Israeli fishermen. It uses the camera to photograph fish and an ML model to identify the species and display fishing regulations."

#### C. Upload the .ipa and submit

**Option 1 - EAS Submit (automated):**
```bash
eas submit --platform ios --profile production
```
EAS will prompt for your Apple ID and App Store Connect credentials.

**Option 2 - Manual via Transporter (macOS):**
1. Download the `.ipa` from EAS build dashboard
2. Open the Transporter app (free on Mac App Store)
3. Drag the `.ipa` into Transporter, click "Deliver"
4. In App Store Connect, select the uploaded build and submit for review

#### D. Review timeline

- **TestFlight (internal):** Available within minutes after processing
- **TestFlight (external):** Requires a brief beta review (1-2 days)
- **App Store production:** First review takes 1-3 business days. Updates are typically reviewed within 24 hours.

#### E. Common rejection reasons and how to avoid them

| Reason | Prevention |
|--------|-----------|
| Incomplete metadata | Fill all required fields before submitting |
| Camera permission without clear purpose | Permission strings already set in `app.json` - keep them descriptive |
| Login required with no demo account | Provide test credentials in "App Review Information" |
| Privacy policy missing | Host a privacy policy and link it in App Store Connect |
| Crashes on launch | Always test the production build on a real device before submitting |

---

## 7. Post-Release Updates (OTA)

Expo supports **Over-The-Air (OTA) updates** for JavaScript-only changes. This means bug fixes and UI tweaks can be pushed instantly without going through store review.

```bash
# Push a JS-only update to all users
eas update --branch production --message "Fix Hebrew text alignment on results screen"
```

**What can be updated OTA:** JavaScript code, styles, images bundled in JS.

**What requires a new store build:** Native module changes, new permissions, Expo SDK upgrades, changes to `app.json`.

---

## 8. Checklist Summary

### Before first release

- [ ] TypeScript compiles without errors (`npm run tsc`)
- [ ] Tested on Android emulator + real device
- [ ] Tested on iOS simulator + real device (if available)
- [ ] API URL points to production CloudFront URL
- [ ] Cognito mobile client ID is configured
- [ ] App icon, splash screen, and adaptive icon assets are final
- [ ] Version in `app.json` is set correctly
- [ ] Privacy policy is hosted and accessible via URL

### Google Play

- [ ] Google Play Developer account created ($25)
- [ ] App created in Google Play Console
- [ ] Store listing complete (description, screenshots, feature graphic)
- [ ] Content rating questionnaire completed
- [ ] Data safety form completed
- [ ] `.aab` uploaded via `eas submit` or manually
- [ ] Internal testing passed
- [ ] Production release submitted

### Apple App Store

- [ ] Apple Developer Program enrolled ($99/year)
- [ ] App created in App Store Connect
- [ ] App information complete (description, screenshots, privacy)
- [ ] Demo account credentials provided in review notes
- [ ] `.ipa` uploaded via `eas submit` or Transporter
- [ ] TestFlight internal testing passed
- [ ] Production release submitted for review

### After release

- [ ] Monitor crash reports in Google Play Console / App Store Connect
- [ ] Use `eas update` for JS-only hotfixes
- [ ] Increment version in `app.json` before each new native build
