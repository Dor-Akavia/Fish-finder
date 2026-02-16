/**
 * src/screens/ResultScreen.tsx - Fish identification result display
 *
 * Receives a FishResult object via React Navigation route params.
 * The result is structured as:
 *
 *  ┌─────────────────────────────┐
 *  │  Hebrew name  (large, RTL)  │
 *  │  Latin species  (italic)    │
 *  ├─────────────────────────────┤
 *  │  [Native]  [Population]     │  ← 2-column grid of FishResultCards
 *  │  [Avg size] [Min legal size]│
 *  │  [Seasonal ban]             │  ← full width, red if active
 *  ├─────────────────────────────┤
 *  │  Notes (full width)         │
 *  │  Description (full width)   │
 *  └─────────────────────────────┘
 *
 * Text direction note:
 *   All scientific/numerical data is presented LTR.
 *   The Hebrew name uses writingDirection: 'rtl' locally so it aligns
 *   naturally without flipping the rest of the layout.
 *
 * Navigation:
 *   "Identify Another Fish" button navigates back to HomeScreen (goBack()).
 */

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';

import { RootStackParamList } from '../../App';
import FishResultCard from '../components/FishResultCard';
import { FishResult } from '../services/api';

type ResultRouteProp = RouteProp<RootStackParamList, 'Result'>;
type ResultNavProp = StackNavigationProp<RootStackParamList, 'Result'>;

export default function ResultScreen(): React.JSX.Element {
  const route = useRoute<ResultRouteProp>();
  const navigation = useNavigation<ResultNavProp>();

  const result: FishResult = route.params.result;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Format a boolean native status into a human-readable label */
  const nativeLabel = result.native ? 'Native species' : 'Non-native / invasive';

  /** Seasonal ban: null means no active ban */
  const banValue = result.seasonal_ban ?? 'No active ban';
  const banHighlight: 'danger' | 'success' =
    result.seasonal_ban !== null ? 'danger' : 'success';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* ── Species header ─────────────────────────────────────────────── */}
        <View style={styles.headerCard}>
          {/* Hebrew name — uses RTL text direction locally */}
          <Text style={styles.hebrewName}>{result.hebrew_name}</Text>

          {/* Latin species name — always LTR, italic */}
          <Text style={styles.latinName}>{result.species}</Text>
        </View>

        {/* ── Data grid ──────────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Species Details</Text>

        {/* Row 1: Native status | Population */}
        <View style={styles.gridRow}>
          <FishResultCard
            label="Origin"
            value={nativeLabel}
            highlight={result.native ? 'success' : undefined}
            style={styles.gridCell}
          />
          <FishResultCard
            label="Population"
            value={result.population}
            highlight={
              result.population.toLowerCase().includes('endangered') ||
              result.population.toLowerCase().includes('declining')
                ? 'danger'
                : undefined
            }
            style={styles.gridCell}
          />
        </View>

        {/* Row 2: Average size | Min legal size */}
        <View style={styles.gridRow}>
          <FishResultCard
            label="Avg. Adult Size"
            value={`${result.avg_size_cm} cm`}
            style={styles.gridCell}
          />
          <FishResultCard
            label="Min. Legal Size"
            value={`${result.min_size_cm} cm`}
            style={styles.gridCell}
          />
        </View>

        {/* Seasonal ban — full width, highlighted */}
        <FishResultCard
          label="Seasonal Fishing Ban"
          value={banValue}
          highlight={banHighlight}
        />

        {/* ── Regulation notes ───────────────────────────────────────────── */}
        {result.notes ? (
          <>
            <Text style={styles.sectionTitle}>Regulation Notes</Text>
            <View style={styles.textCard}>
              <Text style={styles.textCardContent}>{result.notes}</Text>
            </View>
          </>
        ) : null}

        {/* ── Species description ────────────────────────────────────────── */}
        {result.description ? (
          <>
            <Text style={styles.sectionTitle}>About This Species</Text>
            <View style={styles.textCard}>
              <Text style={styles.textCardContent}>{result.description}</Text>
            </View>
          </>
        ) : null}

        {/* ── Back to home ───────────────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Identify Another Fish</Text>
        </Pressable>

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
    padding: 16,
    paddingBottom: 32,
  },

  // Species header card
  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
    borderTopWidth: 4,
    borderTopColor: '#0077b6',
  },
  hebrewName: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#0077b6',
    marginBottom: 6,
    // Allow RTL text direction for the Hebrew name while keeping
    // the rest of the layout LTR.
    writingDirection: 'rtl',
    textAlign: 'center',
  },
  latinName: {
    fontSize: 18,
    fontStyle: 'italic',
    color: '#4b5563',
    textAlign: 'center',
  },

  // Section labels
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },

  // 2-column grid layout
  gridRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  gridCell: {
    flex: 1,
  },

  // Full-width text card for notes / description
  textCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  textCardContent: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 22,
  },

  // Back / identify another button
  backButton: {
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
  backButtonPressed: {
    backgroundColor: '#005f91',
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
