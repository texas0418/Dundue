// src/dbCore.ts
// Pure module: SQL schema/migrations and row<->model mapping.
// No expo imports so it can be tested in Node against node:sqlite.

import type { Client, Invoice, Reminder } from './models';
import { isInvoiceStatus, isStepKey } from './models';

/** Each entry is the batch of statements that upgrades user_version N-1 -> N.
 *  MIGRATIONS[0] builds version 1. Append only; never edit shipped entries. */
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_ms INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      number TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL DEFAULT 0,
      issued_ms INTEGER NOT NULL,
      due_ms INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      paid_ms INTEGER,
      notes TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      step TEXT NOT NULL,
      sent_ms INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_ms)`,
    `CREATE INDEX IF NOT EXISTS idx_reminders_invoice ON reminders(invoice_id)`,
  ],
];

export const TARGET_DB_VERSION = MIGRATIONS.length;

export interface ClientRow {
  id: number;
  name: string;
  email: string;
  notes: string;
  created_ms: number;
}
export interface InvoiceRow {
  id: number;
  client_id: number;
  number: string;
  amount_cents: number;
  issued_ms: number;
  due_ms: number;
  status: string;
  paid_ms: number | null;
  notes: string;
}
export interface ReminderRow {
  id: number;
  invoice_id: number;
  step: string;
  sent_ms: number;
}

export const rowToClient = (r: ClientRow): Client => ({
  id: r.id,
  name: r.name,
  email: r.email,
  notes: r.notes,
  createdMs: r.created_ms,
});
export const rowToInvoice = (r: InvoiceRow): Invoice => ({
  id: r.id,
  clientId: r.client_id,
  number: r.number,
  amountCents: r.amount_cents,
  issuedMs: r.issued_ms,
  dueMs: r.due_ms,
  status: isInvoiceStatus(r.status) ? r.status : 'open',
  paidMs: r.paid_ms,
  notes: r.notes,
});
export const rowToReminder = (r: ReminderRow): Reminder => ({
  id: r.id,
  invoiceId: r.invoice_id,
  step: isStepKey(r.step) ? r.step : 'due',
  sentMs: r.sent_ms,
});

export const clientToParams = (
  c: Client,
): [string, string, string, number] => [c.name, c.email, c.notes, c.createdMs];
export const invoiceToParams = (
  i: Invoice,
): [number, string, number, number, number, string, number | null, string] => [
  i.clientId,
  i.number,
  i.amountCents,
  i.issuedMs,
  i.dueMs,
  i.status,
  i.paidMs,
  i.notes,
];
export const reminderToParams = (
  r: Reminder,
): [number, string, number] => [r.invoiceId, r.step, r.sentMs];

// ----------------------------------------------------------------- clients
export const INSERT_CLIENT_SQL = `INSERT INTO clients (name, email, notes, created_ms) VALUES (?, ?, ?, ?)`;
export const UPDATE_CLIENT_SQL = `UPDATE clients SET name = ?, email = ?, notes = ?, created_ms = ? WHERE id = ?`;
export const DELETE_CLIENT_SQL = `DELETE FROM clients WHERE id = ?`;
export const GET_CLIENT_SQL = `SELECT * FROM clients WHERE id = ?`;
export const LIST_CLIENTS_SQL = `SELECT * FROM clients ORDER BY name COLLATE NOCASE, id`;

// ---------------------------------------------------------------- invoices
export const INSERT_INVOICE_SQL = `INSERT INTO invoices (client_id, number, amount_cents, issued_ms, due_ms, status, paid_ms, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
export const UPDATE_INVOICE_SQL = `UPDATE invoices SET client_id = ?, number = ?, amount_cents = ?, issued_ms = ?, due_ms = ?, status = ?, paid_ms = ?, notes = ? WHERE id = ?`;
export const SET_INVOICE_STATUS_SQL = `UPDATE invoices SET status = ?, paid_ms = ? WHERE id = ?`;
export const DELETE_INVOICE_SQL = `DELETE FROM invoices WHERE id = ?`;
export const GET_INVOICE_SQL = `SELECT * FROM invoices WHERE id = ?`;
export const COUNT_INVOICES_SQL = `SELECT COUNT(*) AS n FROM invoices`;
export const LIST_INVOICES_BY_CLIENT_SQL = `SELECT * FROM invoices WHERE client_id = ? ORDER BY due_ms DESC, id DESC`;

/** Open invoices with the client attached — the home screen in one query. */
export const LIST_OPEN_INVOICES_SQL = `SELECT i.*, c.name AS client_name, c.email AS client_email
  FROM invoices i JOIN clients c ON c.id = i.client_id
  WHERE i.status = 'open' ORDER BY i.due_ms, i.id`;

/** Recently settled invoices (paid or written off), newest settlement first. */
export const LIST_SETTLED_INVOICES_SQL = `SELECT i.*, c.name AS client_name, c.email AS client_email
  FROM invoices i JOIN clients c ON c.id = i.client_id
  WHERE i.status != 'open'
  ORDER BY COALESCE(i.paid_ms, i.due_ms) DESC, i.id DESC LIMIT ?`;

export interface InvoiceWithClientRow extends InvoiceRow {
  client_name: string;
  client_email: string;
}

// --------------------------------------------------------------- reminders
export const INSERT_REMINDER_SQL = `INSERT INTO reminders (invoice_id, step, sent_ms) VALUES (?, ?, ?)`;
export const DELETE_REMINDER_SQL = `DELETE FROM reminders WHERE id = ?`;
export const LIST_REMINDERS_SQL = `SELECT * FROM reminders WHERE invoice_id = ? ORDER BY sent_ms, id`;

/** Every reminder belonging to a still-open invoice (for the send queue). */
export const LIST_OPEN_REMINDERS_SQL = `SELECT r.* FROM reminders r
  JOIN invoices i ON i.id = r.invoice_id WHERE i.status = 'open'`;

// FK cascades require this pragma per-connection in SQLite.
export const ENABLE_FK_SQL = `PRAGMA foreign_keys = ON`;

// ------------------------------------------------------------------ backup
export const ALL_CLIENTS_SQL = `SELECT * FROM clients ORDER BY id`;
export const ALL_INVOICES_SQL = `SELECT * FROM invoices ORDER BY id`;
export const ALL_REMINDERS_SQL = `SELECT * FROM reminders ORDER BY id`;
export const DELETE_ALL_CLIENTS_SQL = `DELETE FROM clients`; // cascades everything

// Restore keeps original ids so cross-table references survive round-trip.
export const RESTORE_CLIENT_SQL = `INSERT INTO clients (id, name, email, notes, created_ms) VALUES (?, ?, ?, ?, ?)`;
export const RESTORE_INVOICE_SQL = `INSERT INTO invoices (id, client_id, number, amount_cents, issued_ms, due_ms, status, paid_ms, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
export const RESTORE_REMINDER_SQL = `INSERT INTO reminders (id, invoice_id, step, sent_ms) VALUES (?, ?, ?, ?)`;
