// src/screens/HomeScreen.tsx
// Home: the "send these today" queue (open invoices whose next ladder step has
// arrived), outstanding/overdue headline, and every open invoice grouped by
// urgency. Recently settled invoices sit at the bottom for reassurance.

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  InvoiceWithClient,
  listOpenInvoices,
  listSettledInvoices,
  sentStepsByOpenInvoice,
} from '../db';
import {
  Step,
  bucketInvoices,
  dueShorthand,
  formatMoney,
  nextStep,
  outstandingCents,
  overdueCents,
} from '../models';
import { useSettings } from '../SettingsContext';
import { Palette, Urgency, useTheme } from '../theme';

interface Props {
  onOpenInvoice: (invoiceId: number) => void;
  onNewInvoice: () => void;
  onClients: () => void;
  onSettings: () => void;
}

interface QueueItem {
  invoice: InvoiceWithClient;
  step: Step;
}

export default function HomeScreen({
  onOpenInvoice,
  onNewInvoice,
  onClients,
  onSettings,
}: Props) {
  const { settings } = useSettings();
  const { colors: c, urgency, statusBarStyle } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [open, setOpen] = useState<InvoiceWithClient[]>(() => listOpenInvoices());
  const [settled, setSettled] = useState<InvoiceWithClient[]>(() =>
    listSettledInvoices(5),
  );
  const [sentByInvoice, setSentByInvoice] = useState(() => sentStepsByOpenInvoice());
  // Upcoming starts collapsed — it's the least urgent and often the longest.
  const [collapsed, setCollapsed] = useState<Set<Urgency>>(() => new Set(['later']));
  const [showSettled, setShowSettled] = useState(false);

  const toggleSection = (key: Urgency) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Kept for parity with sibling apps; the screen also remounts on navigation.
  const reload = useCallback(() => {
    setOpen(listOpenInvoices());
    setSettled(listSettledInvoices(5));
    setSentByInvoice(sentStepsByOpenInvoice());
  }, []);
  void reload;

  const now = Date.now();
  const sym = settings.currencySymbol;

  const queue: QueueItem[] = [];
  for (const inv of open) {
    const step = nextStep(inv.dueMs, sentByInvoice.get(inv.id!) ?? [], now);
    if (step) queue.push({ invoice: inv, step });
  }

  const buckets = bucketInvoices(open, now);
  const outstanding = outstandingCents(open);
  const overdue = overdueCents(open, now);

  const sections: { key: Urgency; title: string; items: InvoiceWithClient[] }[] = [
    { key: 'overdue', title: 'Overdue', items: buckets.overdue },
    { key: 'dueSoon', title: 'Due soon', items: buckets.dueSoon },
    { key: 'later', title: 'Upcoming', items: buckets.later },
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      <StatusBar style={statusBarStyle} />
      <View style={styles.topBar}>
        <Text style={styles.appName}>Dundue</Text>
        <View style={styles.topActions}>
          <Pressable onPress={onClients} hitSlop={8}>
            <Text style={styles.topLink}>Clients</Text>
          </Pressable>
          <Pressable onPress={onSettings} hitSlop={8}>
            <Text style={styles.topLink}>Settings</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Outstanding</Text>
        <Text style={styles.totalValue}>{formatMoney(outstanding, sym)}</Text>
        <Text style={overdue > 0 ? styles.totalOverdue : styles.hint}>
          {overdue > 0
            ? `${formatMoney(overdue, sym)} of that is overdue`
            : `${open.length} open invoice(s) · nothing overdue`}
        </Text>
      </View>

      {queue.length > 0 && (
        <View style={styles.queueCard}>
          <Text style={styles.queueTitle}>
            Reminders to send — {queue.length}
          </Text>
          {queue.map(({ invoice, step }) => (
            <Pressable
              key={invoice.id}
              style={styles.queueRow}
              onPress={() => onOpenInvoice(invoice.id!)}
            >
              <View style={styles.queueLeft}>
                <Text style={styles.queueClient} numberOfLines={1}>
                  {invoice.clientName}
                </Text>
                <Text style={styles.queueStep} numberOfLines={1}>
                  {step.label} · {dueShorthand(invoice.dueMs, now)}
                </Text>
              </View>
              <Text style={styles.queueAmount}>
                {formatMoney(invoice.amountCents, sym)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable style={styles.addBtn} onPress={onNewInvoice}>
        <Text style={styles.addBtnText}>+ Track an invoice</Text>
      </Pressable>

      {open.length === 0 && settled.length === 0 && (
        <Text style={styles.empty}>
          Add an invoice you&apos;re waiting on. Dundue tells you when to nudge —
          and writes the polite email for you.
        </Text>
      )}

      {sections.map(({ key, title, items }) => {
        if (items.length === 0) return null;
        const uc = urgency(key);
        const isCollapsed = collapsed.has(key);
        return (
          <View key={key} style={styles.section}>
            <Pressable style={styles.sectionHeader} onPress={() => toggleSection(key)}>
              <View style={[styles.dot, { backgroundColor: uc.main }]} />
              <Text style={styles.sectionTitle}>{title}</Text>
              <Text style={styles.sectionCount}>{items.length}</Text>
              <Text style={styles.caret}>{isCollapsed ? '▸' : '▾'}</Text>
            </Pressable>
            {!isCollapsed &&
              items.map((inv) => (
              <Pressable
                key={inv.id}
                style={[styles.invoiceCard, { borderLeftColor: uc.main }]}
                onPress={() => onOpenInvoice(inv.id!)}
              >
                <View style={styles.invoiceRow}>
                  <Text style={styles.invoiceClient} numberOfLines={1}>
                    {inv.clientName}
                  </Text>
                  <Text style={styles.invoiceAmount}>
                    {formatMoney(inv.amountCents, sym)}
                  </Text>
                </View>
                <Text style={styles.invoiceSub} numberOfLines={1}>
                  {[inv.number, dueShorthand(inv.dueMs, now)]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Pressable>
            ))}
          </View>
        );
      })}

      {settled.length > 0 && (
        <View style={styles.section}>
          <Pressable
            style={styles.sectionHeader}
            onPress={() => setShowSettled((s) => !s)}
          >
            <View style={[styles.dot, { backgroundColor: urgency('paid').main }]} />
            <Text style={styles.sectionTitle}>Recently settled</Text>
            <Text style={styles.sectionCount}>{settled.length}</Text>
            <Text style={styles.caret}>{showSettled ? '▾' : '▸'}</Text>
          </Pressable>
          {showSettled &&
            settled.map((inv) => (
            <Pressable
              key={inv.id}
              style={styles.settledRow}
              onPress={() => onOpenInvoice(inv.id!)}
            >
              <Text style={styles.settledName} numberOfLines={1}>
                {inv.clientName}
                {inv.number ? ` · ${inv.number}` : ''}
              </Text>
              <Text
                style={[
                  styles.settledStatus,
                  { color: inv.status === 'paid' ? c.success : c.textMuted },
                ]}
              >
                {inv.status === 'paid' ? formatMoney(inv.amountCents, sym) : 'written off'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
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
    appName: { fontSize: 22, fontWeight: '700', color: c.textPrimary },
    topActions: { flexDirection: 'row', gap: 16 },
    topLink: { color: c.accent, fontSize: 14, fontWeight: '500' },
    totalCard: {
      backgroundColor: c.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.cardBorder,
      padding: 14,
      marginBottom: 14,
    },
    totalLabel: { fontSize: 12, color: c.textMuted, textTransform: 'uppercase' },
    totalValue: { fontSize: 28, fontWeight: '700', color: c.textPrimary, marginTop: 2 },
    totalOverdue: { color: c.danger, fontSize: 13, fontWeight: '500', marginTop: 4 },
    queueCard: {
      backgroundColor: c.dueBg,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.dueBorder,
      padding: 14,
      marginBottom: 14,
    },
    queueTitle: { fontSize: 14, fontWeight: '600', color: c.dueText, marginBottom: 6 },
    queueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 7,
      borderTopWidth: 1,
      borderTopColor: c.dueBorder,
      gap: 8,
    },
    queueLeft: { flexShrink: 1 },
    queueClient: { fontSize: 14, fontWeight: '600', color: c.textPrimary },
    queueStep: { fontSize: 12, color: c.dueText, marginTop: 1 },
    queueAmount: { fontSize: 14, fontWeight: '600', color: c.textPrimary },
    addBtn: {
      backgroundColor: c.accent,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      marginBottom: 16,
    },
    addBtnText: { color: c.accentText, fontSize: 15, fontWeight: '600' },
    empty: { color: c.textMuted, fontSize: 14, textAlign: 'center', marginTop: 24 },
    section: { marginBottom: 14 },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
      paddingHorizontal: 2,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    sectionTitle: { fontSize: 15, fontWeight: '600', color: c.textPrimary, flex: 1 },
    sectionCount: { fontSize: 13, color: c.textMuted },
    caret: { fontSize: 12, color: c.textMuted, width: 16, textAlign: 'center' },
    invoiceCard: {
      backgroundColor: c.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.cardBorder,
      borderLeftWidth: 3,
      padding: 12,
      marginBottom: 8,
    },
    invoiceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    invoiceClient: { fontSize: 16, fontWeight: '600', color: c.textPrimary, flexShrink: 1 },
    invoiceAmount: { fontSize: 15, fontWeight: '600', color: c.textPrimary },
    invoiceSub: { fontSize: 13, color: c.textMuted, marginTop: 2 },
    settledRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 2,
      borderBottomWidth: 1,
      borderBottomColor: c.hairline,
      gap: 8,
    },
    settledName: { fontSize: 14, color: c.textBody, flexShrink: 1 },
    settledStatus: { fontSize: 13, fontWeight: '500' },
    hint: { color: c.textMuted, fontSize: 12, marginTop: 4 },
  });
