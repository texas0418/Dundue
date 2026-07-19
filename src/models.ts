// src/models.ts
// Pure module (no expo imports): Dundue's domain model plus the one piece of
// math the app is built around — which polite reminder each open invoice needs
// next. Money is integer cents; times are epoch ms. Due dates are pinned to
// local noon so adding whole days never straddles a DST change, and all
// "is it due yet" comparisons happen on local calendar days via dayKey.

export const INVOICE_STATUSES = ['open', 'paid', 'written_off'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  open: 'Open',
  paid: 'Paid',
  written_off: 'Written off',
};

export const isInvoiceStatus = (v: unknown): v is InvoiceStatus =>
  typeof v === 'string' && (INVOICE_STATUSES as readonly string[]).includes(v);

export interface Client {
  id?: number;
  name: string; // person or company — whoever gets the email
  email: string;
  notes: string;
  createdMs: number;
}

export interface Invoice {
  id?: number;
  clientId: number;
  number: string; // free text: "2026-014", "INV-7", or blank
  amountCents: number;
  issuedMs: number;
  dueMs: number;
  status: InvoiceStatus;
  paidMs: number | null;
  notes: string;
}

/** One reminder actually sent (or logged as sent) for an invoice. */
export interface Reminder {
  id?: number;
  invoiceId: number;
  step: StepKey;
  sentMs: number;
}

// --------------------------------------------------------------- the ladder
//
// The reminder ladder: one courtesy note before the due date, then an
// escalation that stays polite but stops being ignorable. Offsets are days
// relative to the due date. The ladder is ordered; a sent step never repeats,
// and skipping ahead (invoice added when already 20 days late) skips the
// steps it blew past rather than firing them all.

export const STEPS = [
  { key: 'before', offsetDays: -3, label: 'Courtesy heads-up' },
  { key: 'due', offsetDays: 0, label: 'Due today' },
  { key: 'overdue3', offsetDays: 3, label: 'Gentle nudge' },
  { key: 'overdue7', offsetDays: 7, label: 'Follow-up' },
  { key: 'overdue14', offsetDays: 14, label: 'Second follow-up' },
  { key: 'overdue30', offsetDays: 30, label: 'Final notice' },
] as const;

export type Step = (typeof STEPS)[number];
export type StepKey = Step['key'];

export const isStepKey = (v: unknown): v is StepKey =>
  typeof v === 'string' && STEPS.some((s) => s.key === v);

export const stepIndex = (key: StepKey): number =>
  STEPS.findIndex((s) => s.key === key);

export const stepDateMs = (dueMs: number, step: Step): number =>
  addDays(dueMs, step.offsetDays);

/** The reminder an open invoice needs now, or null if it's caught up.
 *  Rule: the LATEST step whose date has arrived (local calendar day), unless
 *  a step that far or further down the ladder was already sent. */
export function nextStep(
  dueMs: number,
  sentSteps: StepKey[],
  nowMs: number,
): Step | null {
  const todayKey = dayKey(nowMs);
  let eligible = -1;
  STEPS.forEach((s, i) => {
    if (dayKey(stepDateMs(dueMs, s)) <= todayKey) eligible = i;
  });
  const maxSent = sentSteps.reduce((m, k) => Math.max(m, stepIndex(k)), -1);
  if (eligible < 0 || eligible <= maxSent) return null;
  return STEPS[eligible];
}

// ------------------------------------------------------------------- dates

/** Local-calendar day key, e.g. 20260719. Comparable with < and >. */
export const dayKey = (ms: number): number => {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

/** Calendar-day add via setDate so DST transitions can't shift the day. */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Whole local calendar days from a to b (positive when b is later). */
export function diffDays(aMs: number, bMs: number): number {
  const mid = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  return Math.round((mid(bMs) - mid(aMs)) / 86400000);
}

/** Days past due; negative while the due date is still ahead. */
export const daysOverdue = (dueMs: number, nowMs: number): number =>
  diffDays(dueMs, nowMs);

/** "2026-07-19" (or 2026-7-19) -> local-noon epoch ms; null if not a real date. */
export function parseYmd(text: string): number | null {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 12);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  )
    return null; // 2026-02-30 etc.
  return date.getTime();
}

export function formatYmd(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** "Jul 19, 2026" — the form used inside reminder emails. */
export function formatDayLong(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Local noon today — the anchor for new issued dates. */
export function todayNoonMs(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
}

// ------------------------------------------------------------------- money

/** 125050 -> "$1,250.50". Symbol comes from Settings. */
export function formatMoney(cents: number, symbol = '$'): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${symbol}${whole}.${(abs % 100).toString().padStart(2, '0')}`;
}

/** "$1,250.50" -> 125050. Returns null for anything that isn't a plain
 *  non-negative dollar amount with at most two decimals. */
export function parseMoneyToCents(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

// ----------------------------------------------------------------- buckets

export interface InvoiceBuckets<T> {
  overdue: T[]; // most overdue first — the top of the list is the oldest debt
  dueSoon: T[]; // due today through +soonDays, soonest first
  later: T[]; // soonest first
}

export function bucketInvoices<T extends { dueMs: number }>(
  items: T[],
  nowMs: number,
  soonDays = 7,
): InvoiceBuckets<T> {
  const out: InvoiceBuckets<T> = { overdue: [], dueSoon: [], later: [] };
  for (const it of items) {
    const over = daysOverdue(it.dueMs, nowMs);
    if (over > 0) out.overdue.push(it);
    else if (over >= -soonDays) out.dueSoon.push(it);
    else out.later.push(it);
  }
  const byDue = (a: T, b: T) => a.dueMs - b.dueMs;
  out.overdue.sort(byDue);
  out.dueSoon.sort(byDue);
  out.later.sort(byDue);
  return out;
}

// ------------------------------------------------------------------ totals

export const outstandingCents = (
  invoices: Pick<Invoice, 'status' | 'amountCents'>[],
): number =>
  invoices
    .filter((i) => i.status === 'open')
    .reduce((sum, i) => sum + i.amountCents, 0);

export const overdueCents = (
  invoices: Pick<Invoice, 'status' | 'amountCents' | 'dueMs'>[],
  nowMs: number,
): number =>
  invoices
    .filter((i) => i.status === 'open' && daysOverdue(i.dueMs, nowMs) > 0)
    .reduce((sum, i) => sum + i.amountCents, 0);

/** "due today" / "due in 3d" / "5d overdue" — list-row shorthand. */
export function dueShorthand(dueMs: number, nowMs: number): string {
  const over = daysOverdue(dueMs, nowMs);
  if (over > 0) return `${over}d overdue`;
  if (over === 0) return 'due today';
  return `due in ${-over}d`;
}
