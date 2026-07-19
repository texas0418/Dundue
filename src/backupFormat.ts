// src/backupFormat.ts
// Pure module (Node-testable): versioned JSON backup format.
// Version 1: clients, invoices, and the reminder log, ids included (restore
// is replace-all, so original ids are safe to keep and cross-table references
// survive the round-trip). Forward rule: parse must tolerate missing fields
// by defaulting, never throw on well-formed older backups.

import type { Client, Invoice, Reminder } from './models';
import { isInvoiceStatus, isStepKey } from './models';

export const BACKUP_FORMAT = 'dundue-backup';
export const BACKUP_VERSION = 1;

export interface BackupV1 {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAtMs: number;
  clients: Client[];
  invoices: Invoice[];
  reminders: Reminder[];
}

export function serializeBackup(
  clients: Client[],
  invoices: Invoice[],
  reminders: Reminder[],
  nowMs: number,
): string {
  const b: BackupV1 = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAtMs: nowMs,
    clients,
    invoices,
    reminders,
  };
  return JSON.stringify(b, null, 1);
}

const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);

/** Returns a validated backup or throws Error with a human-readable reason. */
export function parseBackup(json: string): BackupV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Not a valid backup file (not JSON).');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Not a valid backup file.');
  }
  const o = raw as Record<string, unknown>;
  if (o.format !== BACKUP_FORMAT) {
    throw new Error('Not a Dundue backup file.');
  }
  if (typeof o.version !== 'number' || o.version > BACKUP_VERSION) {
    throw new Error('Backup was made by a newer version of Dundue.');
  }

  const clients: Client[] = [];
  for (const r of Array.isArray(o.clients) ? o.clients : []) {
    if (typeof r !== 'object' || r === null) continue;
    const c = r as Record<string, unknown>;
    if (typeof c.id !== 'number' || typeof c.createdMs !== 'number') continue;
    clients.push({
      id: c.id,
      name: str(c.name, ''),
      email: str(c.email, ''),
      notes: str(c.notes, ''),
      createdMs: c.createdMs,
    });
  }
  const clientIds = new Set(clients.map((c) => c.id!));

  const invoices: Invoice[] = [];
  for (const r of Array.isArray(o.invoices) ? o.invoices : []) {
    if (typeof r !== 'object' || r === null) continue;
    const i = r as Record<string, unknown>;
    if (typeof i.id !== 'number' || !clientIds.has(i.clientId as number)) continue;
    if (typeof i.dueMs !== 'number') continue;
    invoices.push({
      id: i.id,
      clientId: i.clientId as number,
      number: str(i.number, ''),
      amountCents: num(i.amountCents, 0),
      issuedMs: num(i.issuedMs, i.dueMs),
      dueMs: i.dueMs,
      status: isInvoiceStatus(i.status) ? i.status : 'open',
      paidMs: typeof i.paidMs === 'number' ? i.paidMs : null,
      notes: str(i.notes, ''),
    });
  }
  const invoiceIds = new Set(invoices.map((i) => i.id!));

  const reminders: Reminder[] = [];
  for (const r of Array.isArray(o.reminders) ? o.reminders : []) {
    if (typeof r !== 'object' || r === null) continue;
    const m = r as Record<string, unknown>;
    if (typeof m.id !== 'number' || !invoiceIds.has(m.invoiceId as number)) continue;
    if (typeof m.sentMs !== 'number' || !isStepKey(m.step)) continue;
    reminders.push({
      id: m.id,
      invoiceId: m.invoiceId as number,
      step: m.step,
      sentMs: m.sentMs,
    });
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAtMs: num(o.exportedAtMs, 0),
    clients,
    invoices,
    reminders,
  };
}
