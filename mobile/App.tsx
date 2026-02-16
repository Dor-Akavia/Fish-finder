/**
 * App.tsx - Root component for Fish Finder
 *
 * Architecture overview:
 * - AWS Amplify is configured once here at startup with Cognito credentials.
 * - We check authentication state on mount using getCurrentUser().
 * - If the user is authenticated, we render the main navigation stack
 *   (HomeScreen → ResultScreen).
 * - If not authenticated, we render AuthScreen which calls onAuthSuccess()
 *   when login/signup completes, triggering a state update to show the main stack.
 *
 * Navigation stack (react-navigation):
 *   AuthScreen  (standalone, shown when logged out)
 *   └── HomeScreen  (camera / gallery + upload)
 *       └── ResultScreen  (fish identification result)
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Amplify } from 'aws-amplify';

import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import ResultScreen from './src/screens/ResultScreen';
import { getCurrentUser } from './src/services/auth';
import { FishResult } from './src/services/api';

// ---------------------------------------------------------------------------
// AWS Amplify / Cognito configuration
// Replace the placeholder values below with your actual Cognito pool details.
// These are intentionally left as strings so they are easy to swap without
// touching logic code.
// ---------------------------------------------------------------------------
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: 'eu-north-1_USER_POOL_ID',       // e.g. eu-north-1_AbCdEfGhI
      userPoolClientId: 'USER_POOL_CLIENT_ID',      // e.g. 1a2b3c4d5e6f7g8h9i0j
    },
  },
});

// ---------------------------------------------------------------------------
// Navigation type definitions
// ResultScreen receives a FishResult object via route params.
// ---------------------------------------------------------------------------
export type RootStackParamList = {
  Home: undefined;
  Result: { result: FishResult };
};

const Stack = createStackNavigator<RootStackParamList>();

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------
export default function App(): React.JSX.Element {
  // Three possible auth states: 'loading' (checking), 'authenticated', 'unauthenticated'
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  // On mount, check whether a Cognito session already exists (tokens stored by
  // Amplify in SecureStore / AsyncStorage from a previous login).
  useEffect(() => {
    (async () => {
      try {
        const user = await getCurrentUser();
        setAuthState(user ? 'authenticated' : 'unauthenticated');
      } catch {
        setAuthState('unauthenticated');
      }
    })();
  }, []);

  // Show a full-screen spinner while we resolve the initial auth state.
  if (authState === 'loading') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0077b6" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        {authState === 'unauthenticated' ? (
          // AuthScreen is rendered outside the Stack Navigator so it fills the
          // whole screen without a header.  It calls onAuthSuccess() on success.
          <AuthScreen onAuthSuccess={() => setAuthState('authenticated')} />
        ) : (
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerStyle: { backgroundColor: '#0077b6' },
              headerTintColor: '#ffffff',
              headerTitleStyle: { fontWeight: 'bold' },
              cardStyle: { backgroundColor: '#f0f4f8' },
            }}
          >
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{
                title: 'Fish Finder',
                // Allow the user to sign out from the header (handled inside HomeScreen)
                headerRight: undefined,
              }}
            />
            <Stack.Screen
              name="Result"
              component={ResultScreen}
              options={{ title: 'Identification Result' }}
            />
          </Stack.Navigator>
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f4f8',
  },
});
