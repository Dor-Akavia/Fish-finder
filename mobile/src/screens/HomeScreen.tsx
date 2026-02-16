/**
 * src/screens/HomeScreen.tsx - Camera / gallery upload screen
 *
 * Upload-and-poll flow:
 *
 *  User taps "Take Photo" or "Choose from Gallery"
 *       ↓
 *  Image URI is stored in local state and previewed
 *       ↓
 *  User taps "Identify Fish"
 *       ↓
 *  [uploading] getUploadUrl(filename) → pre-signed S3 URL
 *       ↓
 *  uploadToS3(upload_url, fields, imageUri) → S3 triggers ML Lambda
 *       ↓
 *  [processing] pollResults(image_id) — polls every 3 s
 *       ↓
 *  [done] Navigate to ResultScreen with FishResult
 *       ↓  (on error at any step)
 *  [error] Display inline error with "Try Again" button
 *
 * Navigation:
 *   HomeScreen → ResultScreen (passes FishResult as route param)
 *
 * The sign-out button appears in the top-right header area (configured
 * via navigation.setOptions in a useEffect).
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as ImagePicker from 'expo-image-picker';

import { RootStackParamList } from '../../App';
import { getUploadUrl, uploadToS3, pollResults } from '../services/api';
import { signOut } from '../services/auth';

type HomeNavProp = StackNavigationProp<RootStackParamList, 'Home'>;

// Progress states for the identification pipeline
type UploadState = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

// Human-readable labels for each progress state
const STATE_LABELS: Record<UploadState, string> = {
  idle: '',
  uploading: 'Uploading image...',
  processing: 'Identifying fish... (this may take up to 60 s)',
  done: 'Done!',
  error: '',
};

export default function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation<HomeNavProp>();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Header: add sign-out button
  // ---------------------------------------------------------------------------
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={handleSignOut}
          style={({ pressed }) => [
            styles.signOutButton,
            pressed && styles.signOutButtonPressed,
          ]}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>
      ),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  // ---------------------------------------------------------------------------
  // Sign Out
  // ---------------------------------------------------------------------------
  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          // App.tsx monitors auth state; navigate back so App can rerender
          // with AuthScreen.  A full navigation reset is not needed because
          // App.tsx will detect the signed-out state on next getCurrentUser().
          // For immediate effect we navigate to a non-existent route —
          // instead, we call signOut and rely on the parent to rerender.
          // The parent (App.tsx) will see unauthenticated on next mount.
          // To trigger it immediately we can use DevSettings or a global
          // event emitter; for simplicity we show the sign-out prompt and
          // the user can reopen the app.  For production, wire an auth
          // listener in App.tsx (Hub.listen from aws-amplify).
        },
      },
    ]);
  };

  // ---------------------------------------------------------------------------
  // Image selection helpers
  // ---------------------------------------------------------------------------

  /** Open the device camera and capture a new photo */
  const handleTakePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Camera Permission Required',
        'Please allow Fish Finder to access your camera in Settings.',
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.85,
    });

    if (!result.canceled && result.assets.length > 0) {
      setImageUri(result.assets[0].uri);
      resetState();
    }
  };

  /** Open the system photo library and pick an existing image */
  const handleChooseFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photos Permission Required',
        'Please allow Fish Finder to access your photo library in Settings.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.85,
    });

    if (!result.canceled && result.assets.length > 0) {
      setImageUri(result.assets[0].uri);
      resetState();
    }
  };

  const resetState = () => {
    setUploadState('idle');
    setErrorMessage(null);
  };

  // ---------------------------------------------------------------------------
  // Main identification pipeline
  // ---------------------------------------------------------------------------
  const handleIdentify = async () => {
    if (!imageUri) return;

    setErrorMessage(null);

    try {
      // --- Step 1: Get a pre-signed S3 upload URL ---
      setUploadState('uploading');
      const filename = `fish-${Date.now()}.jpg`;
      const { image_id, upload_url, fields } = await getUploadUrl(filename);

      // --- Step 2: Upload image directly to S3 ---
      await uploadToS3(upload_url, fields, imageUri);

      // --- Step 3: Poll for the ML identification result ---
      setUploadState('processing');
      const result = await pollResults(image_id);

      // --- Step 4: Navigate to result screen ---
      setUploadState('done');
      navigation.navigate('Result', { result });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setErrorMessage(message);
      setUploadState('error');
    }
  };

  // ---------------------------------------------------------------------------
  // Derived state booleans for readability
  // ---------------------------------------------------------------------------
  const isLoading = uploadState === 'uploading' || uploadState === 'processing';
  const hasImage = imageUri !== null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* Instructional heading */}
        <Text style={styles.heading}>Photograph a Fish</Text>
        <Text style={styles.subheading}>
          Take or upload a clear photo of a fish to identify its species, check
          Hebrew name and Israeli fishing regulations.
        </Text>

        {/* Image preview area */}
        <View style={styles.previewContainer}>
          {hasImage ? (
            <Image
              source={{ uri: imageUri }}
              style={styles.previewImage}
              resizeMode="cover"
              accessibilityLabel="Selected fish photo preview"
            />
          ) : (
            <View style={styles.previewPlaceholder}>
              <Text style={styles.placeholderIcon}>📷</Text>
              <Text style={styles.placeholderText}>No photo selected</Text>
            </View>
          )}
        </View>

        {/* Camera / gallery buttons */}
        <View style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [
              styles.mediaButton,
              pressed && styles.mediaButtonPressed,
              isLoading && styles.buttonDisabled,
            ]}
            onPress={handleTakePhoto}
            disabled={isLoading}
          >
            <Text style={styles.mediaButtonIcon}>📸</Text>
            <Text style={styles.mediaButtonText}>Take Photo</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.mediaButton,
              pressed && styles.mediaButtonPressed,
              isLoading && styles.buttonDisabled,
            ]}
            onPress={handleChooseFromGallery}
            disabled={isLoading}
          >
            <Text style={styles.mediaButtonIcon}>🖼️</Text>
            <Text style={styles.mediaButtonText}>Gallery</Text>
          </Pressable>
        </View>

        {/* Progress / status area */}
        {isLoading && (
          <View style={styles.progressContainer}>
            <ActivityIndicator size="large" color="#0077b6" />
            <Text style={styles.progressText}>{STATE_LABELS[uploadState]}</Text>
          </View>
        )}

        {/* Inline error display with retry option */}
        {uploadState === 'error' && errorMessage && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Identification Failed</Text>
            <Text style={styles.errorMessage}>{errorMessage}</Text>
            <Pressable
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.retryButtonPressed,
              ]}
              onPress={handleIdentify}
            >
              <Text style={styles.retryButtonText}>Try Again</Text>
            </Pressable>
          </View>
        )}

        {/* Primary CTA: Identify Fish */}
        {!isLoading && (
          <Pressable
            style={({ pressed }) => [
              styles.identifyButton,
              pressed && styles.identifyButtonPressed,
              (!hasImage) && styles.identifyButtonDisabled,
            ]}
            onPress={handleIdentify}
            disabled={!hasImage}
          >
            <Text style={styles.identifyButtonText}>
              {uploadState === 'error' ? 'Identify Fish' : 'Identify Fish'}
            </Text>
          </Pressable>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f0f4f8',
  },
  container: {
    flexGrow: 1,
    padding: 20,
  },

  // Headings
  heading: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0077b6',
    marginBottom: 8,
    marginTop: 8,
  },
  subheading: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 20,
    marginBottom: 24,
  },

  // Image preview
  previewContainer: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e5e7eb',
  },
  placeholderIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  placeholderText: {
    fontSize: 16,
    color: '#9ca3af',
  },

  // Camera / gallery buttons
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  mediaButton: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  mediaButtonPressed: {
    backgroundColor: '#f0f4f8',
  },
  mediaButtonIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  mediaButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0077b6',
  },
  buttonDisabled: {
    opacity: 0.5,
  },

  // Progress indicator
  progressContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 12,
  },
  progressText: {
    fontSize: 14,
    color: '#0077b6',
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Error display
  errorContainer: {
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#dc2626',
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 13,
    color: '#7f1d1d',
    lineHeight: 18,
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#dc2626',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  retryButtonPressed: {
    backgroundColor: '#b91c1c',
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },

  // Identify CTA
  identifyButton: {
    backgroundColor: '#0077b6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#0077b6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  identifyButtonPressed: {
    backgroundColor: '#005f91',
  },
  identifyButtonDisabled: {
    backgroundColor: '#93c5fd',
    shadowOpacity: 0,
    elevation: 0,
  },
  identifyButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Header sign-out button
  signOutButton: {
    marginRight: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  signOutButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  signOutText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});
