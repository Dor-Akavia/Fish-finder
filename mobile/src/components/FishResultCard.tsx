/**
 * src/components/FishResultCard.tsx - Reusable labelled data card
 *
 * Renders a white card with a small label and a prominent value.
 * Optional highlight prop changes the value text colour:
 *   'danger'  → red   (e.g. active fishing ban, declining population)
 *   'success' → green (e.g. native species, no ban)
 *   undefined → default dark text
 *
 * Usage:
 *   <FishResultCard label="Min. Legal Size" value="25 cm" />
 *   <FishResultCard label="Seasonal Ban" value="Mar–May" highlight="danger" />
 *   <FishResultCard label="Origin" value="Native species" highlight="success" />
 *
 * The optional `style` prop allows the parent to pass layout constraints,
 * e.g. flex: 1 inside a flexDirection row for a 2-column grid.
 */

import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

interface Props {
  /** Small descriptive label shown above the value */
  label: string;
  /** The main data value to display */
  value: string;
  /** Optional colour highlight applied to the value text */
  highlight?: 'danger' | 'success';
  /** Optional additional styles for the outer container (e.g. flex: 1) */
  style?: StyleProp<ViewStyle>;
}

export default function FishResultCard({
  label,
  value,
  highlight,
  style,
}: Props): React.JSX.Element {
  // Resolve the value text colour based on the highlight prop
  const valueTextStyle =
    highlight === 'danger'
      ? styles.valueDanger
      : highlight === 'success'
      ? styles.valueSuccess
      : styles.valueDefault;

  // Apply a coloured left border when highlighted for extra visual salience
  const borderStyle =
    highlight === 'danger'
      ? styles.borderDanger
      : highlight === 'success'
      ? styles.borderSuccess
      : undefined;

  return (
    <View style={[styles.card, borderStyle, style]}>
      {/* Label — always shown in muted grey */}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>

      {/* Value — coloured according to highlight */}
      <Text style={[styles.value, valueTextStyle]}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
    // Default: no coloured left border
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
  },

  // Coloured left border variants
  borderDanger: {
    borderLeftColor: '#ef4444',
  },
  borderSuccess: {
    borderLeftColor: '#22c55e',
  },

  // Label text
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },

  // Value text variants
  valueDefault: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  valueDanger: {
    fontSize: 16,
    fontWeight: '700',
    color: '#dc2626',
  },
  valueSuccess: {
    fontSize: 16,
    fontWeight: '700',
    color: '#16a34a',
  },
});
