// src/screens/ClientsScreen.tsx
// Clients: who owes what, and the email each reminder goes to. Tap a client
// to edit inline; deleting warns that their invoices go too.

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
import {
  createClient,
  deleteClient,
  listClients,
  listInvoicesByClient,
  updateClient,
} from '../db';
import { Client, formatMoney, outstandingCents } from '../models';
import { useSettings } from '../SettingsContext';
import { Palette, useTheme } from '../theme';

interface Props {
  onBack: () => void;
}

export default function ClientsScreen({ onBack }: Props) {
  const { settings } = useSettings();
  const { colors: c, statusBarStyle } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [clients, setClients] = useState<Client[]>(() => listClients());
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const reload = () => setClients(listClients());

  const addClient = () => {
    const name = newName.trim();
    if (!name) return;
    createClient({ name, email: '', notes: '', createdMs: Date.now() });
    setNewName('');
    reload();
  };

  const startEdit = (cl: Client) => {
    setEditingId(cl.id!);
    setEditName(cl.name);
    setEditEmail(cl.email);
    setEditNotes(cl.notes);
  };

  const saveEdit = (cl: Client) => {
    const name = editName.trim();
    if (!name) {
      Alert.alert('Name required', 'A client needs a name.');
      return;
    }
    updateClient({ ...cl, name, email: editEmail.trim(), notes: editNotes.trim() });
    setEditingId(null);
    reload();
  };

  const confirmDelete = (cl: Client) => {
    const open = listInvoicesByClient(cl.id!).filter((i) => i.status === 'open');
    Alert.alert(
      `Delete ${cl.name}?`,
      open.length > 0
        ? `This deletes their invoices too — including ${open.length} still open. There is no undo.`
        : 'This deletes their invoices and reminder history too. There is no undo.',
      [
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteClient(cl.id!);
            setEditingId(null);
            reload();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

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
        <Text style={styles.title}>Clients</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          placeholder="New client…"
          placeholderTextColor={c.textMuted}
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={addClient}
          returnKeyType="done"
        />
        <Pressable style={styles.addBtn} onPress={addClient}>
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </View>

      {clients.length === 0 && (
        <Text style={styles.empty}>
          Clients appear here automatically when you track an invoice, or add
          one above.
        </Text>
      )}

      {clients.map((cl) => {
        const invoices = listInvoicesByClient(cl.id!);
        const owed = outstandingCents(invoices);
        const editing = editingId === cl.id;
        return (
          <View key={cl.id} style={styles.card}>
            <Pressable onPress={() => (editing ? setEditingId(null) : startEdit(cl))}>
              <View style={styles.cardRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {cl.name}
                </Text>
                <Text style={owed > 0 ? styles.owed : styles.owedZero}>
                  {owed > 0
                    ? formatMoney(owed, settings.currencySymbol)
                    : 'settled up'}
                </Text>
              </View>
              <Text style={styles.sub} numberOfLines={1}>
                {[cl.email || 'no email', `${invoices.length} invoice(s)`].join(' · ')}
              </Text>
            </Pressable>
            {editing && (
              <View style={styles.editArea}>
                <TextInput
                  style={styles.input}
                  placeholder="Name"
                  placeholderTextColor={c.textMuted}
                  value={editName}
                  onChangeText={setEditName}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Email (where reminders go)"
                  placeholderTextColor={c.textMuted}
                  value={editEmail}
                  onChangeText={setEditEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Notes"
                  placeholderTextColor={c.textMuted}
                  value={editNotes}
                  onChangeText={setEditNotes}
                />
                <View style={styles.editBtns}>
                  <Pressable style={styles.saveBtn} onPress={() => saveEdit(cl)}>
                    <Text style={styles.saveBtnText}>Save</Text>
                  </Pressable>
                  <Pressable style={styles.btn} onPress={() => setEditingId(null)}>
                    <Text style={styles.btnText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.btn} onPress={() => confirmDelete(cl)}>
                    <Text style={[styles.btnText, { color: c.danger }]}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        );
      })}
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
    addRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    addInput: {
      flex: 1,
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.cardBorder,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: c.textPrimary,
    },
    addBtn: {
      backgroundColor: c.accent,
      borderRadius: 10,
      paddingHorizontal: 18,
      justifyContent: 'center',
    },
    addBtnText: { color: c.accentText, fontSize: 15, fontWeight: '600' },
    empty: { color: c.textMuted, fontSize: 14, textAlign: 'center', marginTop: 24 },
    card: {
      backgroundColor: c.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.cardBorder,
      padding: 12,
      marginBottom: 8,
    },
    cardRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    name: { fontSize: 16, fontWeight: '600', color: c.textPrimary, flexShrink: 1 },
    owed: { fontSize: 15, fontWeight: '600', color: c.textPrimary },
    owedZero: { fontSize: 13, color: c.success },
    sub: { fontSize: 13, color: c.textMuted, marginTop: 2 },
    editArea: { marginTop: 4 },
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
    editBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
    saveBtn: {
      backgroundColor: c.accent,
      borderRadius: 10,
      paddingVertical: 9,
      paddingHorizontal: 16,
    },
    saveBtnText: { color: c.accentText, fontSize: 14, fontWeight: '600' },
    btn: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.cardBorder,
      paddingVertical: 9,
      paddingHorizontal: 16,
    },
    btnText: { color: c.textBody, fontSize: 14, fontWeight: '500' },
  });
