// src/screens/InvoiceScreen.tsx
// One invoice: add/edit its facts, see where it sits on the reminder ladder,
// and — the point of the app — compose the next polite reminder with one tap
// into the mail app or share sheet. Reminder history logs what was sent so the
// ladder never repeats itself.

import { useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  addReminder,
  countInvoices,
  createClient,
  createInvoice,
  deleteInvoice,
  deleteReminder,
  getClient,
  getInvoice,
  listClients,
  listReminders,
  updateInvoice,
} from '../db';
import {
  Client,
  Invoice,
  STEPS,
  StepKey,
  addDays,
  daysOverdue,
  diffDays,
  dueShorthand,
  formatDayLong,
  formatMoney,
  formatYmd,
  nextStep,
  parseMoneyToCents,
  parseYmd,
  stepIndex,
  todayNoonMs,
} from '../models';
import { mailtoUrl, renderReminder } from '../messages';
import { useProAccess } from '../proAccess';
import { FREE_INVOICES } from '../revenuecat';
import { useSettings } from '../SettingsContext';
import { Palette, useTheme } from '../theme';

interface Props {
  invoiceId: number | null; // null = new invoice
  onBack: () => void;
}

const TERM_CHIPS = [7, 14, 30] as const;

export default function InvoiceScreen({ invoiceId, onBack }: Props) {
  const { settings } = useSettings();
  const pro = useProAccess();
  const { colors: c, statusBarStyle } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [invoice, setInvoice] = useState<Invoice | null>(() =>
    invoiceId == null ? null : getInvoice(invoiceId),
  );
  const [clients] = useState<Client[]>(() => listClients());
  const [reminders, setReminders] = useState(() =>
    invoiceId == null ? [] : listReminders(invoiceId),
  );

  // ---- editable fields (shared by new + edit) ----
  const now = Date.now();
  const [clientId, setClientId] = useState<number | 'new'>(
    invoice?.clientId ?? (clients.length ? clients[0].id! : 'new'),
  );
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [numberText, setNumberText] = useState(invoice?.number ?? '');
  const [amountText, setAmountText] = useState(
    invoice ? (invoice.amountCents / 100).toFixed(2) : '',
  );
  const [issuedText, setIssuedText] = useState(
    formatYmd(invoice?.issuedMs ?? todayNoonMs(now)),
  );
  const [dueText, setDueText] = useState(
    formatYmd(
      invoice?.dueMs ?? addDays(todayNoonMs(now), settings.defaultTermsDays),
    ),
  );
  const [notes, setNotes] = useState(invoice?.notes ?? '');

  const client =
    invoice != null
      ? getClient(invoice.clientId)
      : typeof clientId === 'number'
        ? (clients.find((x) => x.id === clientId) ?? null)
        : null;

  const setTerms = (days: number) => {
    const issued = parseYmd(issuedText);
    if (issued != null) setDueText(formatYmd(addDays(issued, days)));
  };

  const validate = (): Omit<Invoice, 'clientId'> | null => {
    const amount = parseMoneyToCents(amountText);
    const issued = parseYmd(issuedText);
    const due = parseYmd(dueText);
    if (amount == null || amount <= 0) {
      Alert.alert('Check the amount', 'Enter the invoice amount, e.g. 1250.50');
      return null;
    }
    if (issued == null || due == null) {
      Alert.alert('Check the dates', 'Dates need to look like 2026-07-19.');
      return null;
    }
    return {
      id: invoice?.id,
      number: numberText.trim(),
      amountCents: amount,
      issuedMs: issued,
      dueMs: due,
      status: invoice?.status ?? 'open',
      paidMs: invoice?.paidMs ?? null,
      notes: notes.trim(),
    };
  };

  const save = () => {
    const fields = validate();
    if (!fields) return;

    if (invoice == null) {
      if (!pro && countInvoices() >= FREE_INVOICES) {
        Alert.alert(
          'Invoice limit reached',
          `The free version tracks ${FREE_INVOICES} invoices. Unlock Dundue Pro in Settings for unlimited invoices — everything else stays free.`,
        );
        return;
      }
      let cid: number;
      if (clientId === 'new') {
        const name = newClientName.trim();
        if (!name) {
          Alert.alert('Who is this for?', 'Enter the client name.');
          return;
        }
        cid = createClient({
          name,
          email: newClientEmail.trim(),
          notes: '',
          createdMs: now,
        });
      } else {
        cid = clientId;
      }
      createInvoice({ ...fields, clientId: cid });
      onBack();
    } else {
      const next = { ...invoice, ...fields, clientId: invoice.clientId };
      updateInvoice(next);
      setInvoice(next);
      Alert.alert('Saved', 'Invoice updated.');
    }
  };

  const setStatus = (status: Invoice['status']) => {
    if (!invoice) return;
    const paidMs = status === 'paid' ? Date.now() : null;
    const next = { ...invoice, status, paidMs };
    updateInvoice(next);
    setInvoice(next);
  };

  const confirmDelete = () => {
    if (!invoice) return;
    Alert.alert(
      'Delete invoice?',
      'This also deletes its reminder history. There is no undo.',
      [
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteInvoice(invoice.id!);
            onBack();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  // ---- the composer ----
  const sentSteps = reminders.map((r) => r.step);
  const step = invoice?.status === 'open' ? nextStep(invoice.dueMs, sentSteps, now) : null;
  const message =
    invoice && client && step
      ? renderReminder(step.key, {
          clientName: client.name,
          businessName: settings.businessName,
          yourName: settings.yourName,
          invoiceNumber: invoice.number,
          amountText: formatMoney(invoice.amountCents, settings.currencySymbol),
          dueDateText: formatDayLong(invoice.dueMs),
          daysOverdue: daysOverdue(invoice.dueMs, now),
        })
      : null;

  const markSent = (key: StepKey) => {
    if (!invoice) return;
    addReminder({ invoiceId: invoice.id!, step: key, sentMs: Date.now() });
    setReminders(listReminders(invoice.id!));
  };

  const offerMarkSent = (key: StepKey) => {
    Alert.alert('Log this reminder?', 'Marking it sent moves the ladder along.', [
      { text: 'Mark sent', onPress: () => markSent(key) },
      { text: 'Not yet', style: 'cancel' },
    ]);
  };

  const openEmail = async () => {
    if (!message || !client || !step) return;
    try {
      await Linking.openURL(mailtoUrl(client.email, message.subject, message.body));
      offerMarkSent(step.key);
    } catch {
      Alert.alert('No mail app', 'Could not open an email app. Try Share instead.');
    }
  };

  const share = async () => {
    if (!message || !step) return;
    const res = await Share.share({ message: `${message.subject}\n\n${message.body}` });
    if (res.action !== Share.dismissedAction) offerMarkSent(step.key);
  };

  const removeReminder = (id: number, label: string) => {
    if (!invoice) return;
    Alert.alert('Remove from history?', `"${label}" will become sendable again.`, [
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          deleteReminder(id);
          setReminders(listReminders(invoice.id!));
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const overdueDays = invoice ? daysOverdue(invoice.dueMs, now) : 0;
  const ladderDone =
    invoice?.status === 'open' &&
    !step &&
    sentSteps.length > 0 &&
    sentSteps.some((k) => stepIndex(k) === STEPS.length - 1);

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
        <Text style={styles.title}>{invoice ? 'Invoice' : 'New invoice'}</Text>
        <View style={{ width: 44 }} />
      </View>

      {invoice && client && (
        <View style={styles.card}>
          <View style={styles.headRow}>
            <Text style={styles.headClient} numberOfLines={1}>
              {client.name}
            </Text>
            <Text style={styles.headAmount}>
              {formatMoney(invoice.amountCents, settings.currencySymbol)}
            </Text>
          </View>
          <Text style={styles.headSub}>
            {invoice.status === 'open'
              ? dueShorthand(invoice.dueMs, now)
              : invoice.status === 'paid'
                ? `paid ${invoice.paidMs ? formatDayLong(invoice.paidMs) : ''}`
                : 'written off'}
            {invoice.status === 'open' && overdueDays > 0
              ? ` · due ${formatDayLong(invoice.dueMs)}`
              : ''}
          </Text>
        </View>
      )}

      {message && step && (
        <View style={styles.composerCard}>
          <Text style={styles.composerKicker}>Ready to send</Text>
          <Text style={styles.composerStep}>{step.label}</Text>
          <View style={styles.preview}>
            <Text style={styles.previewSubject}>{message.subject}</Text>
            <Text style={styles.previewBody}>{message.body}</Text>
          </View>
          {client && !client.email.trim() && (
            <Text style={styles.warn}>
              No email on file for {client.name} — add one in Clients, or use Share.
            </Text>
          )}
          <View style={styles.composerBtns}>
            {client && client.email.trim() !== '' && (
              <Pressable style={styles.primaryBtn} onPress={openEmail}>
                <Text style={styles.primaryBtnText}>Open in Email</Text>
              </Pressable>
            )}
            <Pressable style={styles.btn} onPress={share}>
              <Text style={styles.btnText}>Share…</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => markSent(step.key)}>
              <Text style={styles.btnText}>Mark sent</Text>
            </Pressable>
          </View>
        </View>
      )}

      {invoice?.status === 'open' && !step && (
        <View style={styles.card}>
          <Text style={styles.hint}>
            {ladderDone
              ? 'The reminder ladder is done. Consider a call — or write it off below.'
              : 'Nothing to send right now. Dundue will queue the next reminder when its day comes.'}
          </Text>
        </View>
      )}

      {invoice == null && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Client</Text>
          <View style={styles.chipRow}>
            {clients.map((cl) => {
              const on = clientId === cl.id;
              return (
                <Pressable
                  key={cl.id}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => setClientId(cl.id!)}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {cl.name}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.chip, clientId === 'new' && styles.chipOn]}
              onPress={() => setClientId('new')}
            >
              <Text
                style={[styles.chipText, clientId === 'new' && styles.chipTextOn]}
              >
                + New client
              </Text>
            </Pressable>
          </View>
          {clientId === 'new' && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Client name"
                placeholderTextColor={c.textMuted}
                value={newClientName}
                onChangeText={setNewClientName}
              />
              <TextInput
                style={styles.input}
                placeholder="Email (where reminders go)"
                placeholderTextColor={c.textMuted}
                value={newClientEmail}
                onChangeText={setNewClientEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </>
          )}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Details</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Invoice #</Text>
          <TextInput
            style={styles.numInput}
            placeholder="optional"
            placeholderTextColor={c.textMuted}
            value={numberText}
            onChangeText={setNumberText}
          />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={styles.numInput}
            placeholder="1250.50"
            placeholderTextColor={c.textMuted}
            value={amountText}
            onChangeText={setAmountText}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Issued</Text>
          <TextInput
            style={styles.numInput}
            placeholder="2026-07-19"
            placeholderTextColor={c.textMuted}
            value={issuedText}
            onChangeText={setIssuedText}
          />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Due</Text>
          <TextInput
            style={styles.numInput}
            placeholder="2026-08-18"
            placeholderTextColor={c.textMuted}
            value={dueText}
            onChangeText={setDueText}
          />
        </View>
        <View style={styles.chipRow}>
          {TERM_CHIPS.map((d) => (
            <Pressable key={d} style={styles.chip} onPress={() => setTerms(d)}>
              <Text style={styles.chipText}>net {d}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          style={[styles.input, styles.notesInput]}
          placeholder="Notes"
          placeholderTextColor={c.textMuted}
          value={notes}
          onChangeText={setNotes}
          multiline
        />
        <Pressable style={styles.primaryBtn} onPress={save}>
          <Text style={styles.primaryBtnText}>
            {invoice ? 'Save changes' : 'Start tracking'}
          </Text>
        </Pressable>
      </View>

      {invoice && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Status</Text>
          <View style={styles.composerBtns}>
            {invoice.status !== 'paid' && (
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: c.success }]}
                onPress={() => setStatus('paid')}
              >
                <Text style={styles.primaryBtnText}>Mark paid</Text>
              </Pressable>
            )}
            {invoice.status !== 'open' && (
              <Pressable style={styles.btn} onPress={() => setStatus('open')}>
                <Text style={styles.btnText}>Reopen</Text>
              </Pressable>
            )}
            {invoice.status === 'open' && (
              <Pressable style={styles.btn} onPress={() => setStatus('written_off')}>
                <Text style={styles.btnText}>Write off</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {invoice && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Reminder history</Text>
          {reminders.length === 0 && (
            <Text style={styles.hint}>Nothing sent yet.</Text>
          )}
          {reminders.map((r) => {
            const label = STEPS[stepIndex(r.step)].label;
            return (
              <Pressable
                key={r.id}
                style={styles.historyRow}
                onLongPress={() => removeReminder(r.id!, label)}
              >
                <Text style={styles.historyStep}>{label}</Text>
                <Text style={styles.historyDate}>{formatDayLong(r.sentMs)}</Text>
              </Pressable>
            );
          })}
          {reminders.length > 0 && (
            <Text style={styles.hint}>Long-press an entry to remove it.</Text>
          )}
        </View>
      )}

      {invoice && (
        <Pressable style={styles.deleteBtn} onPress={confirmDelete}>
          <Text style={styles.deleteText}>Delete invoice</Text>
        </Pressable>
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
    headRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    headClient: { fontSize: 18, fontWeight: '700', color: c.textPrimary, flexShrink: 1 },
    headAmount: { fontSize: 18, fontWeight: '700', color: c.textPrimary },
    headSub: { fontSize: 13, color: c.textMuted, marginTop: 2 },
    composerCard: {
      backgroundColor: c.dueBg,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.dueBorder,
      padding: 14,
      marginBottom: 14,
    },
    composerKicker: {
      fontSize: 11,
      color: c.dueText,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    composerStep: { fontSize: 17, fontWeight: '700', color: c.textPrimary, marginTop: 2 },
    preview: {
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.cardBorder,
      padding: 12,
      marginTop: 10,
    },
    previewSubject: { fontSize: 14, fontWeight: '600', color: c.textPrimary },
    previewBody: { fontSize: 13, color: c.textBody, marginTop: 8, lineHeight: 19 },
    warn: { color: c.danger, fontSize: 12, marginTop: 8 },
    composerBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    primaryBtn: {
      backgroundColor: c.accent,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 16,
      alignItems: 'center',
      marginTop: 10,
    },
    primaryBtnText: { color: c.accentText, fontSize: 15, fontWeight: '600' },
    btn: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.cardBorder,
      backgroundColor: c.card,
      paddingVertical: 10,
      paddingHorizontal: 16,
      alignItems: 'center',
      marginTop: 10,
    },
    btnText: { color: c.textBody, fontSize: 15, fontWeight: '500' },
    sectionTitle: { fontSize: 16, fontWeight: '600', color: c.textPrimary, marginBottom: 4 },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 10,
    },
    label: { fontSize: 15, color: c.textPrimary },
    numInput: {
      backgroundColor: c.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.cardBorder,
      paddingHorizontal: 12,
      paddingVertical: 7,
      fontSize: 15,
      color: c.textPrimary,
      minWidth: 140,
      textAlign: 'right',
    },
    input: {
      backgroundColor: c.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.cardBorder,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 15,
      color: c.textPrimary,
      marginTop: 10,
    },
    notesInput: { minHeight: 60, textAlignVertical: 'top' },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 10,
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
    historyRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.hairline,
    },
    historyStep: { fontSize: 14, color: c.textPrimary, fontWeight: '500' },
    historyDate: { fontSize: 13, color: c.textMuted },
    deleteBtn: { alignItems: 'center', paddingVertical: 12, marginBottom: 8 },
    deleteText: { color: c.danger, fontSize: 14, fontWeight: '500' },
    hint: { color: c.textMuted, fontSize: 12, marginTop: 4 },
  });
