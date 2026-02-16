# Mobile App Setup

> **Status: Planned / Not Yet Active**
> The mobile app is planned for future development. The code in `mobile/` contains initial scaffolding with navigation and Cognito authentication, but is not yet feature-complete. The web app is the current production interface.

The Fish Finder mobile app is a React Native application built with Expo (~51). It will support iOS and Android and provide the same photograph-and-identify workflow as the web app, with native camera and photo library access.

---

## Prerequisites

| Tool | Minimum Version | Notes |
|---|---|---|
| Node.js | 18+ | LTS recommended |
| npm | 9+ | Included with Node 18 |
| Expo CLI | Latest | `npm install -g expo-cli` |
| Expo Go | Latest | Optional — install on a physical device for rapid testing |
| iOS Simulator | Xcode 15+ | macOS only; required for iOS testing without a physical device |
| Android Emulator | Android Studio | Required for Android testing without a physical device |

You do **not** need Xcode or Android Studio to run the app via Expo Go on a physical device.

---

## Install and Run

### 1. Install dependencies

```bash
cd mobile/
npm install
```

This installs all packages listed in `package.json`, including:

- `expo` (~51)
- `react-native` (0.74.1)
- `aws-amplify` + `@aws-amplify/auth` (^6.3.3)
- `expo-camera` + `expo-image-picker`
- `@react-navigation/native` + `@react-navigation/stack`

### 2. Start the development server

```bash
npm start
# or equivalently:
npx expo start
```

This opens the Expo developer tools in your browser and prints a QR code in the terminal.

**Running on a physical device (easiest):**
- Install Expo Go from the App Store (iOS) or Google Play (Android).
- Scan the QR code with the camera app (iOS) or the Expo Go app (Android).

**Running on iOS Simulator (macOS only):**
```bash
npm run ios
# or press 'i' in the Expo terminal after npm start
```

**Running on Android Emulator:**
```bash
npm run android
# or press 'a' in the Expo terminal after npm start
```

---

## Configure Cognito

After `terraform apply`, the Terraform outputs include the Cognito identifiers needed by the mobile app. Paste them into the Amplify configuration in your entry point file (`App.tsx` or equivalent):

```typescript
import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId:       '<cognito_user_pool_id>',      // Terraform output: cognito_user_pool_id
      userPoolClientId: '<cognito_mobile_client_id>',  // Terraform output: cognito_mobile_client_id
      region:           'eu-north-1',
    }
  }
});
```

Retrieve the values from Terraform:

```bash
cd infrastracture/
terraform output cognito_user_pool_id
terraform output cognito_mobile_client_id
```

**Important:** Use `cognito_mobile_client_id`, not `cognito_webapp_client_id`. The two app clients are separate so their credentials can be rotated independently.

---

## Configure the API Base URL

The mobile app calls the same Flask REST API as the web frontend. Set the base URL to point at your CloudFront distribution:

```typescript
// src/services/api.ts  (or wherever your API client is configured)
export const API_BASE_URL = 'https://<cloudfront_url>';
```

Get the CloudFront URL from Terraform:

```bash
terraform output cloudfront_url
```

For local development, point at the Flask server running on your machine:

```typescript
// Local dev only:
export const API_BASE_URL = 'http://<YOUR_MACHINE_LOCAL_IP>:5000';
```

Use your machine's LAN IP (not `localhost`) because the app runs on a physical device or emulator that is not the same host as the dev server. Find your IP with `ipconfig` (Windows) or `ifconfig` / `ip a` (Linux/macOS).

---

## Permissions

The app requests these permissions at runtime. They are declared in `app.json`:

| Platform | Permission | Purpose |
|---|---|---|
| iOS | `NSCameraUsageDescription` | Photograph a fish for identification |
| iOS | `NSPhotoLibraryUsageDescription` | Choose an existing fish photo from the library |
| Android | `CAMERA` | Photograph a fish for identification |
| Android | `READ_EXTERNAL_STORAGE` | Choose an existing photo from the gallery |

Expo handles the runtime permission prompts via `expo-camera` and `expo-image-picker`. No additional configuration is needed.

---

## Project Structure

```
mobile/
├── app.json          Expo configuration (bundle IDs, permissions, splash screen)
├── package.json      Dependencies and npm scripts
├── tsconfig.json     TypeScript configuration
└── src/
    ├── screens/      Screen components (camera, results, login, etc.)
    ├── components/   Shared UI components
    └── services/     API client, auth helpers
```

---

## Building for Production

Production builds are created with **Expo Application Services (EAS Build)**, which builds the native app in the cloud — no local Xcode or Android SDK required.

### 1. Install EAS CLI

```bash
npm install -g eas-cli
eas login
```

### 2. Configure EAS

If you have not done so already, initialise EAS in the project:

```bash
cd mobile/
eas build:configure
```

This creates `eas.json` with build profiles (`development`, `preview`, `production`).

### 3. Build the app

```bash
# iOS (produces a .ipa file)
eas build --platform ios --profile production

# Android (produces a .aab file for the Play Store, or .apk for direct install)
eas build --platform android --profile production

# Both platforms simultaneously
eas build --platform all --profile production
```

EAS Build queues the build on Expo's infrastructure. You will receive an email and a link to download the artifact when it completes (typically 5–15 minutes).

### 4. Verify bundle identifiers

Before submitting, confirm the bundle identifiers in `app.json` match your Apple Developer / Google Play accounts:

```json
"ios": {
  "bundleIdentifier": "com.fishfinder.app"
},
"android": {
  "package": "com.fishfinder.app"
}
```

---

## Submitting to App Stores

### Apple App Store

1. Enrol in the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year).
2. Create an App Store Connect record for `com.fishfinder.app`.
3. Configure the required capabilities: camera, photo library.
4. Submit the `.ipa` built by EAS using EAS Submit:
   ```bash
   eas submit --platform ios
   ```
5. Complete the App Store Connect metadata (description, screenshots, privacy policy).
6. Submit for Apple review (typically 1–3 business days).

### Google Play Store

1. Create a [Google Play Developer account](https://play.google.com/console/) ($25 one-time fee).
2. Create a new app in the Google Play Console for `com.fishfinder.app`.
3. Submit the `.aab` built by EAS using EAS Submit:
   ```bash
   eas submit --platform android
   ```
4. Complete the store listing (description, screenshots, content rating questionnaire).
5. Submit for Google Play review (typically a few hours to a few days for first submissions).

### Notes

- Both stores require a privacy policy URL because the app accesses the camera and photo library.
- Apple will ask about the app's use of camera and photo library access — reference the fishing regulation and species identification use case in the review notes.
- The app is currently set to portrait orientation only (`"orientation": "portrait"` in `app.json`).
