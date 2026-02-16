/**
 * src/screens/AuthScreen.tsx - Authentication screen (Sign In / Sign Up)
 *
 * UI flow:
 *   Mode: 'signin'
 *     Email + Password → signIn() → onAuthSuccess()
 *
 *   Mode: 'signup'
 *     Email + Password → signUp() → switches to 'confirm' sub-step
 *
 *   Mode: 'confirm'  (after successful signUp)
 *     Email (pre-filled, read-only) + 6-digit code → confirmSignUp()
 *     On success, automatically signs the user in and calls onAuthSuccess()
 *
 * The screen has no navigation header; it fills the entire safe area.
 * Errors are displayed inline in red beneath the submit button.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signIn, signUp, confirmSignUp } from '../services/auth';
import * as amplifyAuth from '../services/auth';

type AuthMode = 'signin' | 'signup' | 'confirm';

interface Props {
  /** Called when the user successfully authenticates (sign in or confirm) */
  onAuthSuccess: () => void;
}

export default function AuthScreen({ onAuthSuccess }: Props): React.JSX.Element {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear error whenever the user starts typing
  const clearError = () => setError(null);

  // ---------------------------------------------------------------------------
  // Submit handler — delegates to the correct auth flow based on current mode
  // ---------------------------------------------------------------------------
  const handleSubmit = async () => {
    setError(null);

    // Basic client-side validation
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (mode !== 'confirm' && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (mode === 'confirm' && code.trim().length !== 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        // Authenticate an existing user; Amplify stores tokens automatically
        await signIn(email.trim(), password);
        onAuthSuccess();
      } else if (mode === 'signup') {
        // Register a new account; Cognito sends a verification email
        await signUp(email.trim(), password);
        // Advance to the code confirmation step
        setMode('confirm');
      } else {
        // mode === 'confirm'
        // Verify the account with the emailed code, then sign in automatically
        await confirmSignUp(email.trim(), code.trim());
        await amplifyAuth.signIn(email.trim(), password);
        onAuthSuccess();
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Derived labels based on current mode
  // ---------------------------------------------------------------------------
  const isSignIn = mode === 'signin';
  const isConfirm = mode === 'confirm';

  const titleText = isSignIn ? 'Welcome Back' : isConfirm ? 'Verify Email' : 'Create Account';
  const subtitleText = isSignIn
    ? 'Sign in to identify fish'
    : isConfirm
    ? `Enter the 6-digit code sent to ${email}`
    : 'Register to start identifying fish';
  const submitLabel = isSignIn ? 'Sign In' : isConfirm ? 'Verify' : 'Sign Up';
  const toggleLabel = isSignIn
    ? "Don't have an account? Sign Up"
    : isConfirm
    ? 'Back to Sign In'
    : 'Already have an account? Sign In';

  const handleToggle = () => {
    setError(null);
    setCode('');
    setMode(isSignIn ? 'signup' : 'signin');
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {/* App logo / title area */}
          <View style={styles.headerArea}>
            <Text style={styles.logo}>🐟</Text>
            <Text style={styles.appName}>Fish Finder</Text>
            <Text style={styles.tagline}>Israeli Fish Identification</Text>
          </View>

          {/* Auth card */}
          <View style={styles.card}>
            <Text style={styles.title}>{titleText}</Text>
            <Text style={styles.subtitle}>{subtitleText}</Text>

            {/* Email field — always visible */}
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, isConfirm && styles.inputDisabled]}
              value={email}
              onChangeText={(t) => { setEmail(t); clearError(); }}
              placeholder="you@example.com"
              placeholderTextColor="#9ca3af"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isConfirm}
              returnKeyType={isConfirm ? 'next' : 'next'}
              testID="email-input"
            />

            {/* Password field — hidden during confirmation step */}
            {!isConfirm && (
              <>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={(t) => { setPassword(t); clearError(); }}
                  placeholder="Min. 8 characters"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                  testID="password-input"
                />
              </>
            )}

            {/* Verification code field — only during confirm step */}
            {isConfirm && (
              <>
                <Text style={styles.label}>Verification Code</Text>
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={(t) => { setCode(t); clearError(); }}
                  placeholder="123456"
                  placeholderTextColor="#9ca3af"
                  keyboardType="number-pad"
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                  testID="code-input"
                />
              </>
            )}

            {/* Inline error message */}
            {error !== null && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Submit button */}
            <Pressable
              style={({ pressed }) => [
                styles.submitButton,
                pressed && styles.submitButtonPressed,
                loading && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={loading}
              testID="submit-button"
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.submitButtonText}>{submitLabel}</Text>
              )}
            </Pressable>

            {/* Toggle between sign in / sign up */}
            <Pressable onPress={handleToggle} disabled={loading} style={styles.toggleButton}>
              <Text style={styles.toggleText}>{toggleLabel}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0077b6',
  },
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },

  // Header / logo area
  headerArea: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    fontSize: 64,
    marginBottom: 8,
  },
  appName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 14,
    color: '#90e0ef',
    marginTop: 4,
  },

  // Auth card
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0077b6',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 20,
  },

  // Form fields
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  inputDisabled: {
    backgroundColor: '#f3f4f6',
    color: '#9ca3af',
  },

  // Error display
  errorContainer: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    lineHeight: 18,
  },

  // Submit button
  submitButton: {
    backgroundColor: '#0077b6',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  submitButtonPressed: {
    backgroundColor: '#005f91',
  },
  submitButtonDisabled: {
    backgroundColor: '#93c5fd',
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Toggle link
  toggleButton: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 8,
  },
  toggleText: {
    color: '#0077b6',
    fontSize: 14,
    fontWeight: '500',
  },
});
