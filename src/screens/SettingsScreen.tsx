// src/screens/SettingsScreen.tsx
// Appearance (system/light/dark), the reminder signature (your name +
// business), currency symbol, default terms, backup export/import (never
// gated), Pro section.

import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { exportBackup, pickBackup } from '../backup';
import { replaceAll } from '../db';
import { ThemeMode, useSettings } from '../SettingsContext';
import { useProAccess, isFailOpen, purchasePro, restorePurchases } from '../proAccess';
import { FREE_INVOICES } from '../revenuecat';
import { Palette, useTheme } from '../theme';

interface Props {
  onBack: () => void;
}

const THEME_CHOICES: { mode: ThemeMode; label: string }[] = [
  { mode: 'system', label: 'System' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
];

export default function SettingsScreen({ onBack }: Props) {
  const { settings, update } = useSettings();
  const pro = useProAccess();
  const { colors: c, statusBarStyle } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [busy, setBusy] = useState(false);
  const [termsText, setTermsText] = useState(settings.defaultTermsDays.toString());

  const saveTerms = () => {
    const n = Number(termsText.replace(/[^0-9]/g, ''));
    if (n > 0 && n <= 365) update({ defaultTermsDays: n });
    else setTermsText(settings.defaultTermsDays.toString());
  };

  const doExport = async () => {
    setBusy(true);
    try {
      await exportBackup();
    } catch (e: any) {
      Alert.alert('Export failed', String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const backup = await pickBackup();
      if (!backup) return;
      Alert.alert(
        'Restore backup?',
        `This replaces everything in Dundue with ${backup.invoices.length} invoice(s) across ${backup.clients.length} client(s) from the file. There is no undo.`,
        [
          {
            text: 'Replace all',
            style: 'destructive',
            onPress: () => {
              replaceAll(backup);
              Alert.alert('Restored', 'Backup loaded.');
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } catch (e: any) {
      Alert.alert('Import failed', String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const buyPro = () =>
    purchasePro()
      .then((ok) => ok && Alert.alert('Thanks!', 'Unlimited invoices unlocked.'))
      .catch((e) => Alert.alert('Purchase failed', String(e?.message ?? e)));

  const restore = () =>
    restorePurchases()
      .then((ok) =>
        Alert.alert(ok ? 'Restored' : 'Nothing to restore', ok ? 'Pro is active.' : undefined),
      )
      .catch((e) => Alert.alert('Restore failed', String(e?.message ?? e)));

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <StatusBar style={statusBarStyle} />
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.topLink}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Your signature</Text>
        <Text style={styles.hint}>Every reminder signs off with these.</Text>
        <TextInput
          style={styles.input}
          placeholder="Your name"
          placeholderTextColor={c.textMuted}
          value={settings.yourName}
          onChangeText={(t) => update({ yourName: t })}
        />
        <TextInput
          style={styles.input}
          placeholder="Business name (optional)"
          placeholderTextColor={c.textMuted}
          value={settings.businessName}
          onChangeText={(t) => update({ businessName: t })}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Invoices</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Currency symbol</Text>
          <TextInput
            style={styles.numInput}
            value={settings.currencySymbol}
            onChangeText={(t) => update({ currencySymbol: t })}
          />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Default terms (days)</Text>
          <TextInput
            style={styles.numInput}
            value={termsText}
            onChangeText={setTermsText}
            onEndEditing={saveTerms}
            keyboardType="number-pad"
          />
        </View>
        <Text style={styles.hint}>New invoices default to due = issued + terms.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.chipRow}>
          {THEME_CHOICES.map(({ mode, label }) => {
            const on = settings.themeMode === mode;
            return (
              <Pressable
                key={mode}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => update({ themeMode: mode })}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>System follows your phone's light/dark setting.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Backup</Text>
        <Text style={styles.hint}>
          Everything stays on this phone. Backups are plain JSON you keep wherever you like.
        </Text>
        <Pressable style={styles.btn} onPress={doExport} disabled={busy}>
          <Text style={styles.btnText}>Export backup</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={doImport} disabled={busy}>
          <Text style={styles.btnText}>Import backup</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Dundue Pro</Text>
        {pro ? (
          <Text style={styles.hint}>
            {isFailOpen()
              ? 'Pro is unlocked in this build.'
              : 'Unlimited invoices — thanks for the support.'}
          </Text>
        ) : (
          <>
            <Text style={styles.hint}>
              One-time purchase for unlimited invoices. The first {FREE_INVOICES} are
              free, and clients, reminders, and export are free forever.
            </Text>
            <Pressable style={styles.btn} onPress={buyPro}>
              <Text style={styles.btnText}>Unlock unlimited invoices</Text>
            </Pressable>
          </>
        )}
        <Pressable style={styles.btn} onPress={restore}>
          <Text style={styles.btnText}>Restore purchases</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    scroll: { padding: 16, paddingTop: 0, paddingBottom: 48 },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 64,
      paddingBottom: 12,
    },
    title: { fontSize: 17, fontWeight: '600', color: c.textPrimary },
    topLink: { color: c.textMuted, fontSize: 14, width: 44 },
    card: {
      backgroundColor: c.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.cardBorder,
      padding: 14,
      marginBottom: 14,
    },
    sectionTitle: { fontSize: 16, fontWeight: '600', color: c.textPrimary, marginBottom: 4 },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 10,
    },
    label: { fontSize: 15, color: c.textPrimary },
    input: {
      backgroundColor: c.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.cardBorder,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 15,
      color: c.textPrimary,
      marginTop: 8,
    },
    numInput: {
      backgroundColor: c.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.cardBorder,
      paddingHorizontal: 12,
      paddingVertical: 7,
      fontSize: 15,
      color: c.textPrimary,
      minWidth: 90,
      textAlign: 'right',
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 8,
      alignItems: 'center',
    },
    chip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.cardBorder,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { fontSize: 13, color: c.textBody },
    chipTextOn: { fontSize: 13, color: c.accentText, fontWeight: '500' },
    hint: { color: c.textMuted, fontSize: 12, marginTop: 4, marginBottom: 6 },
    btn: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.cardBorder,
      paddingVertical: 10,
      alignItems: 'center',
      marginTop: 8,
    },
    btnText: { color: c.textBody, fontSize: 15, fontWeight: '500' },
  });
