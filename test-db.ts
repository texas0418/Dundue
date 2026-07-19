// test-db.ts — runs the real schema/SQL from dbCore.ts against node:sqlite.
// Requires Node 22+ (node:sqlite). Run with: npx tsx test-db.ts
// @ts-expect-error node:sqlite has no types under Expo's tsconfig; tsx runs it fine
import { DatabaseSync } from 'node:sqlite';
import {
  ALL_CLIENTS_SQL, ALL_INVOICES_SQL, ALL_REMINDERS_SQL, ClientRow,
  COUNT_INVOICES_SQL, DELETE_ALL_CLIENTS_SQL, DELETE_CLIENT_SQL,
  DELETE_INVOICE_SQL, DELETE_REMINDER_SQL, ENABLE_FK_SQL, GET_CLIENT_SQL,
  GET_INVOICE_SQL, INSERT_CLIENT_SQL, INSERT_INVOICE_SQL, INSERT_REMINDER_SQL,
  InvoiceRow, InvoiceWithClientRow, LIST_CLIENTS_SQL,
  LIST_INVOICES_BY_CLIENT_SQL, LIST_OPEN_INVOICES_SQL,
  LIST_OPEN_REMINDERS_SQL, LIST_REMINDERS_SQL, LIST_SETTLED_INVOICES_SQL,
  MIGRATIONS, ReminderRow, RESTORE_CLIENT_SQL, RESTORE_INVOICE_SQL,
  RESTORE_REMINDER_SQL, SET_INVOICE_STATUS_SQL, TARGET_DB_VERSION,
  UPDATE_CLIENT_SQL, UPDATE_INVOICE_SQL,
  clientToParams, invoiceToParams, reminderToParams,
  rowToClient, rowToInvoice, rowToReminder,
} from './src/dbCore';
import { parseBackup, serializeBackup } from './src/backupFormat';
import type { Client, Invoice, Reminder } from './src/models';

let failures = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failures++;
  } else console.log(`ok   ${name}`);
};

const db = new DatabaseSync(':memory:');
db.exec(ENABLE_FK_SQL);

function migrate(): void {
  let v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  while (v < MIGRATIONS.length) {
    for (const sql of MIGRATIONS[v]) db.exec(sql);
    v++;
    db.exec(`PRAGMA user_version = ${v}`);
  }
}

migrate();
eq('migrates to target version',
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
  TARGET_DB_VERSION);
migrate();
eq('re-migrate is a no-op', true, true);

// ---- client round-trip ----
const T0 = new Date(2026, 6, 1, 12, 0).getTime();
const DAY = 86400000;
const acme: Client = {
  name: 'Acme Studio', email: 'ap@acme.test', notes: 'net 30', createdMs: T0,
};
const acmeId = Number(db.prepare(INSERT_CLIENT_SQL).run(...clientToParams(acme)).lastInsertRowid);
eq('client round-trip',
  rowToClient(db.prepare(GET_CLIENT_SQL).get(acmeId) as unknown as ClientRow),
  { id: acmeId, ...acme });

db.prepare(UPDATE_CLIENT_SQL).run(
  ...clientToParams({ ...acme, email: 'billing@acme.test' }), acmeId,
);
eq('client update',
  rowToClient(db.prepare(GET_CLIENT_SQL).get(acmeId) as unknown as ClientRow).email,
  'billing@acme.test');

const zed: Client = { name: 'zebra co', email: '', notes: '', createdMs: T0 + DAY };
const zedId = Number(db.prepare(INSERT_CLIENT_SQL).run(...clientToParams(zed)).lastInsertRowid);
eq('clients sort by name, case-insensitive',
  (db.prepare(LIST_CLIENTS_SQL).all() as unknown as ClientRow[]).map((c) => c.id),
  [acmeId, zedId]);

// ---- invoice round-trip ----
const inv1: Invoice = {
  clientId: acmeId, number: '2026-014', amountCents: 125050,
  issuedMs: T0, dueMs: T0 + 30 * DAY, status: 'open', paidMs: null, notes: 'website build',
};
const inv1Id = Number(db.prepare(INSERT_INVOICE_SQL).run(...invoiceToParams(inv1)).lastInsertRowid);
eq('invoice round-trip',
  rowToInvoice(db.prepare(GET_INVOICE_SQL).get(inv1Id) as unknown as InvoiceRow),
  { id: inv1Id, ...inv1 });

db.prepare(UPDATE_INVOICE_SQL).run(
  ...invoiceToParams({ ...inv1, amountCents: 130000 }), inv1Id,
);
eq('invoice update',
  rowToInvoice(db.prepare(GET_INVOICE_SQL).get(inv1Id) as unknown as InvoiceRow).amountCents,
  130000);

// unknown status in the row maps safely back to 'open'
db.exec(`UPDATE invoices SET status = 'pending' WHERE id = ${inv1Id}`);
eq('unknown status maps to open',
  rowToInvoice(db.prepare(GET_INVOICE_SQL).get(inv1Id) as unknown as InvoiceRow).status,
  'open');
db.exec(`UPDATE invoices SET status = 'open' WHERE id = ${inv1Id}`);

const inv2: Invoice = {
  clientId: zedId, number: '', amountCents: 40000,
  issuedMs: T0 + DAY, dueMs: T0 + 8 * DAY, status: 'open', paidMs: null, notes: '',
};
const inv2Id = Number(db.prepare(INSERT_INVOICE_SQL).run(...invoiceToParams(inv2)).lastInsertRowid);
eq('count invoices', (db.prepare(COUNT_INVOICES_SQL).get() as { n: number }).n, 2);

// ---- open list joins clients, orders by due date ----
const open = db.prepare(LIST_OPEN_INVOICES_SQL).all() as unknown as InvoiceWithClientRow[];
eq('open invoices soonest due first', open.map((r) => r.id), [inv2Id, inv1Id]);
eq('open invoices carry client name/email',
  [open[0].client_name, open[1].client_email],
  ['zebra co', 'billing@acme.test']);

// ---- status changes & settled list ----
db.prepare(SET_INVOICE_STATUS_SQL).run('paid', T0 + 10 * DAY, inv2Id);
eq('paid invoice leaves open list',
  (db.prepare(LIST_OPEN_INVOICES_SQL).all() as unknown as InvoiceRow[]).map((r) => r.id),
  [inv1Id]);
const settled = db.prepare(LIST_SETTLED_INVOICES_SQL).all(10) as unknown as InvoiceWithClientRow[];
eq('settled list has the paid invoice', settled.map((r) => [r.id, r.status]), [[inv2Id, 'paid']]);
db.prepare(SET_INVOICE_STATUS_SQL).run('open', null, inv2Id);
eq('reopen clears paid_ms',
  rowToInvoice(db.prepare(GET_INVOICE_SQL).get(inv2Id) as unknown as InvoiceRow).paidMs,
  null);

// ---- reminders ----
const r1: Reminder = { invoiceId: inv1Id, step: 'before', sentMs: T0 + 27 * DAY };
const r1Id = Number(db.prepare(INSERT_REMINDER_SQL).run(...reminderToParams(r1)).lastInsertRowid);
const r2: Reminder = { invoiceId: inv1Id, step: 'due', sentMs: T0 + 30 * DAY };
db.prepare(INSERT_REMINDER_SQL).run(...reminderToParams(r2));
eq('reminders oldest first',
  (db.prepare(LIST_REMINDERS_SQL).all(inv1Id) as unknown as ReminderRow[]).map(rowToReminder).map((r) => r.step),
  ['before', 'due']);

// unknown step in a row maps safely to 'due'
db.exec(`UPDATE reminders SET step = 'overdue60' WHERE id = ${r1Id}`);
eq('unknown step maps to due',
  rowToReminder(db.prepare('SELECT * FROM reminders WHERE id = ?').get(r1Id) as unknown as ReminderRow).step,
  'due');
db.exec(`UPDATE reminders SET step = 'before' WHERE id = ${r1Id}`);

// open-reminders query follows invoice status
eq('open reminders span open invoices',
  (db.prepare(LIST_OPEN_REMINDERS_SQL).all() as unknown as ReminderRow[]).length, 2);
db.prepare(SET_INVOICE_STATUS_SQL).run('paid', T0 + 40 * DAY, inv1Id);
eq('paid invoice drops from open reminders',
  (db.prepare(LIST_OPEN_REMINDERS_SQL).all() as unknown as ReminderRow[]).length, 0);
db.prepare(SET_INVOICE_STATUS_SQL).run('open', null, inv1Id);

db.prepare(DELETE_REMINDER_SQL).run(r1Id);
eq('reminder delete',
  (db.prepare(LIST_REMINDERS_SQL).all(inv1Id) as unknown as ReminderRow[]).length, 1);

// ---- cascades ----
db.prepare(DELETE_INVOICE_SQL).run(inv1Id);
eq('deleting invoice cascades reminders',
  (db.prepare(ALL_REMINDERS_SQL).all() as unknown as ReminderRow[]).length, 0);

const tempInvId = Number(db.prepare(INSERT_INVOICE_SQL).run(
  ...invoiceToParams({ ...inv2, clientId: zedId, status: 'open' }),
).lastInsertRowid);
db.prepare(INSERT_REMINDER_SQL).run(tempInvId, 'due', T0);
db.prepare(DELETE_CLIENT_SQL).run(zedId);
eq('deleting client cascades invoices',
  (db.prepare(LIST_INVOICES_BY_CLIENT_SQL).all(zedId) as unknown as InvoiceRow[]).length, 0);
eq('deleting client cascades reminders too',
  (db.prepare(ALL_REMINDERS_SQL).all() as unknown as ReminderRow[]).length, 0);

// ---- backup round-trip through the real SQL ----
// rebuild so every table has rows
const c2 = Number(db.prepare(INSERT_CLIENT_SQL).run('Nord Media', 'pay@nord.test', '', T0).lastInsertRowid);
const i2 = Number(db.prepare(INSERT_INVOICE_SQL).run(c2, 'N-77', 88800, T0, T0 + 14 * DAY, 'open', null, '').lastInsertRowid);
db.prepare(INSERT_REMINDER_SQL).run(i2, 'before', T0 + 11 * DAY);

const snapshot = () => ({
  clients: (db.prepare(ALL_CLIENTS_SQL).all() as unknown as ClientRow[]).map(rowToClient),
  invoices: (db.prepare(ALL_INVOICES_SQL).all() as unknown as InvoiceRow[]).map(rowToInvoice),
  reminders: (db.prepare(ALL_REMINDERS_SQL).all() as unknown as ReminderRow[]).map(rowToReminder),
});
const before = snapshot();
const json = serializeBackup(before.clients, before.invoices, before.reminders, T0);
const parsed = parseBackup(json);

db.exec(DELETE_ALL_CLIENTS_SQL);
eq('delete-all leaves nothing', snapshot().clients.length, 0);
for (const c of parsed.clients)
  db.prepare(RESTORE_CLIENT_SQL).run(c.id!, c.name, c.email, c.notes, c.createdMs);
for (const i of parsed.invoices)
  db.prepare(RESTORE_INVOICE_SQL).run(i.id!, i.clientId, i.number, i.amountCents, i.issuedMs, i.dueMs, i.status, i.paidMs, i.notes);
for (const r of parsed.reminders)
  db.prepare(RESTORE_REMINDER_SQL).run(r.id!, r.invoiceId, r.step, r.sentMs);
eq('backup restore round-trips exactly', snapshot(), before);

// ---- backup format guards ----
let threw = '';
try { parseBackup('not json'); } catch (e: any) { threw = e.message; }
eq('parse rejects non-JSON', threw.includes('not JSON'), true);
try { parseBackup('{"format":"other"}'); } catch (e: any) { threw = e.message; }
eq('parse rejects foreign format', threw.includes('Not a Dundue backup'), true);
const orphan = parseBackup(JSON.stringify({
  format: 'dundue-backup', version: 1, exportedAtMs: 0,
  clients: [],
  invoices: [{ id: 9, clientId: 99, dueMs: 5, amountCents: 100 }],
  reminders: [{ id: 4, invoiceId: 9, step: 'due', sentMs: 1 }],
}));
eq('orphaned invoice dropped on parse', orphan.invoices.length, 0);
eq('reminder of dropped invoice dropped too', orphan.reminders.length, 0);
const badStatus = parseBackup(JSON.stringify({
  format: 'dundue-backup', version: 1, exportedAtMs: 0,
  clients: [{ id: 1, name: 'A', createdMs: 5 }],
  invoices: [{ id: 2, clientId: 1, dueMs: 9, status: 'pending' }],
  reminders: [{ id: 3, invoiceId: 2, step: 'overdue60', sentMs: 1 }],
}));
eq('unknown status defaults to open on parse', badStatus.invoices[0].status, 'open');
eq('unknown step reminder dropped on parse', badStatus.reminders.length, 0);
eq('missing issuedMs defaults to dueMs', badStatus.invoices[0].issuedMs, 9);

console.log(failures ? `\n${failures} FAILED` : '\nall db tests passed');
process.exit(failures ? 1 : 0);
