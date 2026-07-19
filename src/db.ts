// src/db.ts
// expo-sqlite wrapper. All SQL and mapping live in dbCore.ts (pure, tested).
// Billowe pattern: lazy singleton, PRAGMA user_version migrations in a
// transaction, integer epoch-ms / integer cents everywhere.

import * as SQLite from 'expo-sqlite';
import type { Client, Invoice, Reminder, StepKey } from './models';
import type { BackupV1 } from './backupFormat';
import {
  ALL_CLIENTS_SQL,
  ALL_INVOICES_SQL,
  ALL_REMINDERS_SQL,
  ClientRow,
  COUNT_INVOICES_SQL,
  DELETE_ALL_CLIENTS_SQL,
  DELETE_CLIENT_SQL,
  DELETE_INVOICE_SQL,
  DELETE_REMINDER_SQL,
  ENABLE_FK_SQL,
  GET_CLIENT_SQL,
  GET_INVOICE_SQL,
  INSERT_CLIENT_SQL,
  INSERT_INVOICE_SQL,
  INSERT_REMINDER_SQL,
  InvoiceRow,
  InvoiceWithClientRow,
  LIST_CLIENTS_SQL,
  LIST_INVOICES_BY_CLIENT_SQL,
  LIST_OPEN_INVOICES_SQL,
  LIST_OPEN_REMINDERS_SQL,
  LIST_REMINDERS_SQL,
  LIST_SETTLED_INVOICES_SQL,
  MIGRATIONS,
  ReminderRow,
  RESTORE_CLIENT_SQL,
  RESTORE_INVOICE_SQL,
  RESTORE_REMINDER_SQL,
  SET_INVOICE_STATUS_SQL,
  UPDATE_CLIENT_SQL,
  UPDATE_INVOICE_SQL,
  clientToParams,
  invoiceToParams,
  reminderToParams,
  rowToClient,
  rowToInvoice,
  rowToReminder,
} from './dbCore';

const DB_NAME = 'dundue.db';

let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync(DB_NAME);
    db.execSync('PRAGMA journal_mode = WAL');
    db.execSync(ENABLE_FK_SQL);
    runMigrations(db);
  }
  return db;
}

function runMigrations(d: SQLite.SQLiteDatabase): void {
  const row = d.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const batch = MIGRATIONS[version];
    d.withTransactionSync(() => {
      for (const sql of batch) d.execSync(sql);
    });
    version++;
    d.execSync(`PRAGMA user_version = ${version}`);
  }
}

// ----------------------------------------------------------------- clients

export function createClient(c: Client): number {
  const res = getDb().runSync(INSERT_CLIENT_SQL, clientToParams(c));
  return Number(res.lastInsertRowId);
}

export function updateClient(c: Client): void {
  if (c.id == null) throw new Error('updateClient requires id');
  getDb().runSync(UPDATE_CLIENT_SQL, [...clientToParams(c), c.id]);
}

export function deleteClient(id: number): void {
  getDb().runSync(DELETE_CLIENT_SQL, [id]);
}

export function getClient(id: number): Client | null {
  const row = getDb().getFirstSync<ClientRow>(GET_CLIENT_SQL, [id]);
  return row ? rowToClient(row) : null;
}

export function listClients(): Client[] {
  return getDb().getAllSync<ClientRow>(LIST_CLIENTS_SQL).map(rowToClient);
}

// ---------------------------------------------------------------- invoices

export function createInvoice(i: Invoice): number {
  const res = getDb().runSync(INSERT_INVOICE_SQL, invoiceToParams(i));
  return Number(res.lastInsertRowId);
}

export function updateInvoice(i: Invoice): void {
  if (i.id == null) throw new Error('updateInvoice requires id');
  getDb().runSync(UPDATE_INVOICE_SQL, [...invoiceToParams(i), i.id]);
}

export function setInvoiceStatus(
  id: number,
  status: Invoice['status'],
  paidMs: number | null,
): void {
  getDb().runSync(SET_INVOICE_STATUS_SQL, [status, paidMs, id]);
}

export function deleteInvoice(id: number): void {
  getDb().runSync(DELETE_INVOICE_SQL, [id]);
}

export function getInvoice(id: number): Invoice | null {
  const row = getDb().getFirstSync<InvoiceRow>(GET_INVOICE_SQL, [id]);
  return row ? rowToInvoice(row) : null;
}

export function countInvoices(): number {
  return getDb().getFirstSync<{ n: number }>(COUNT_INVOICES_SQL)?.n ?? 0;
}

export function listInvoicesByClient(clientId: number): Invoice[] {
  return getDb()
    .getAllSync<InvoiceRow>(LIST_INVOICES_BY_CLIENT_SQL, [clientId])
    .map(rowToInvoice);
}

export interface InvoiceWithClient extends Invoice {
  clientName: string;
  clientEmail: string;
}

const rowToInvoiceWithClient = (r: InvoiceWithClientRow): InvoiceWithClient => ({
  ...rowToInvoice(r),
  clientName: r.client_name,
  clientEmail: r.client_email,
});

export function listOpenInvoices(): InvoiceWithClient[] {
  return getDb()
    .getAllSync<InvoiceWithClientRow>(LIST_OPEN_INVOICES_SQL)
    .map(rowToInvoiceWithClient);
}

export function listSettledInvoices(limit: number): InvoiceWithClient[] {
  return getDb()
    .getAllSync<InvoiceWithClientRow>(LIST_SETTLED_INVOICES_SQL, [limit])
    .map(rowToInvoiceWithClient);
}

// --------------------------------------------------------------- reminders

export function addReminder(r: Reminder): number {
  const res = getDb().runSync(INSERT_REMINDER_SQL, reminderToParams(r));
  return Number(res.lastInsertRowId);
}

export function deleteReminder(id: number): void {
  getDb().runSync(DELETE_REMINDER_SQL, [id]);
}

export function listReminders(invoiceId: number): Reminder[] {
  return getDb()
    .getAllSync<ReminderRow>(LIST_REMINDERS_SQL, [invoiceId])
    .map(rowToReminder);
}

/** Sent steps per open invoice — feeds nextStep() for the whole queue at once. */
export function sentStepsByOpenInvoice(): Map<number, StepKey[]> {
  const out = new Map<number, StepKey[]>();
  for (const row of getDb().getAllSync<ReminderRow>(LIST_OPEN_REMINDERS_SQL)) {
    const r = rowToReminder(row);
    const list = out.get(r.invoiceId) ?? [];
    list.push(r.step);
    out.set(r.invoiceId, list);
  }
  return out;
}

// ------------------------------------------------------------------ backup

export function getAllForBackup(): {
  clients: Client[];
  invoices: Invoice[];
  reminders: Reminder[];
} {
  const d = getDb();
  return {
    clients: d.getAllSync<ClientRow>(ALL_CLIENTS_SQL).map(rowToClient),
    invoices: d.getAllSync<InvoiceRow>(ALL_INVOICES_SQL).map(rowToInvoice),
    reminders: d.getAllSync<ReminderRow>(ALL_REMINDERS_SQL).map(rowToReminder),
  };
}

/** Restore: replace-all inside one transaction (Billowe backup semantics). */
export function replaceAll(backup: BackupV1): void {
  const d = getDb();
  d.withTransactionSync(() => {
    d.execSync(DELETE_ALL_CLIENTS_SQL); // cascades invoices/reminders
    for (const c of backup.clients)
      d.runSync(RESTORE_CLIENT_SQL, [c.id!, c.name, c.email, c.notes, c.createdMs]);
    for (const i of backup.invoices)
      d.runSync(RESTORE_INVOICE_SQL, [
        i.id!, i.clientId, i.number, i.amountCents, i.issuedMs, i.dueMs,
        i.status, i.paidMs, i.notes,
      ]);
    for (const r of backup.reminders)
      d.runSync(RESTORE_REMINDER_SQL, [r.id!, r.invoiceId, r.step, r.sentMs]);
  });
}
