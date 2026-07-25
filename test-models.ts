// test-models.ts — pure-module tests for the reminder ladder, date math,
// money, buckets, and the message templates. No expo, no sqlite.
// Run with: npx tsx test-models.ts

import {
  STEPS,
  addDays,
  bucketInvoices,
  dayKey,
  daysOverdue,
  diffDays,
  dueShorthand,
  formatDayLong,
  formatMoney,
  formatYmd,
  isInvoiceStatus,
  isStepKey,
  nextStep,
  outstandingCents,
  overdueCents,
  parseMoneyToCents,
  parseYmd,
  stepDateMs,
  todayNoonMs,
} from './src/models';
import { mailtoUrl, renderReminder } from './src/messages';

let failures = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failures++;
  } else console.log(`ok   ${name}`);
};

const noon = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();

// ---- money ----
eq('parse plain dollars', parseMoneyToCents('20'), 2000);
eq('parse cents', parseMoneyToCents('20.5'), 2050);
eq('parse full', parseMoneyToCents('1,250.50'), 125050);
eq('parse $ sign', parseMoneyToCents('$1250.50'), 125050);
eq('parse rejects junk', parseMoneyToCents('abc'), null);
eq('parse rejects empty', parseMoneyToCents(''), null);
eq('parse rejects 3 decimals', parseMoneyToCents('12.345'), null);
eq('format adds commas', formatMoney(125050), '$1,250.50');
eq('format small', formatMoney(500), '$5.00');
eq('format million', formatMoney(123456789), '$1,234,567.89');
eq('format other symbol', formatMoney(2000, '€'), '€20.00');

// ---- dates ----
const DUE = noon(2026, 6, 19); // Jul 19, 2026
eq('parseYmd round-trip', formatYmd(parseYmd('2026-07-19')!), '2026-07-19');
eq('parseYmd single digits', formatYmd(parseYmd('2026-7-9')!), '2026-07-09');
eq('parseYmd rejects junk', parseYmd('next tuesday'), null);
eq('parseYmd rejects Feb 30', parseYmd('2026-02-30'), null);
eq('parseYmd pins to noon', new Date(parseYmd('2026-07-19')!).getHours(), 12);
eq('formatDayLong', formatDayLong(DUE), 'Jul 19, 2026');
eq('dayKey', dayKey(DUE), 20260719);
eq('addDays crosses month', formatYmd(addDays(DUE, 15)), '2026-08-03');
eq('addDays negative', formatYmd(addDays(DUE, -3)), '2026-07-16');
// DST: US spring-forward Mar 8 2026 — a calendar-day add must not slip a day
eq('addDays across DST', formatYmd(addDays(noon(2026, 2, 7), 1)), '2026-03-08');
eq('addDays across DST +3', formatYmd(addDays(noon(2026, 2, 7), 3)), '2026-03-10');
eq('diffDays', diffDays(DUE, noon(2026, 6, 24)), 5);
eq('diffDays negative', diffDays(DUE, noon(2026, 6, 16)), -3);
eq('diffDays ignores clock time', diffDays(new Date(2026, 6, 19, 23).getTime(), new Date(2026, 6, 20, 1).getTime()), 1);
eq('daysOverdue before due', daysOverdue(DUE, noon(2026, 6, 10)), -9);
eq('todayNoonMs', new Date(todayNoonMs(new Date(2026, 6, 19, 3).getTime())).getHours(), 12);

// ---- the ladder ----
eq('ladder shape', STEPS.map((s) => s.offsetDays), [-3, 0, 3, 7, 14, 30]);
eq('stepDateMs', formatYmd(stepDateMs(DUE, STEPS[0])), '2026-07-16');

// nothing eligible yet: 10 days before due
eq('quiet before the window', nextStep(DUE, [], noon(2026, 6, 9)), null);
// courtesy window opens at due-3
eq('courtesy at T-3', nextStep(DUE, [], noon(2026, 6, 16))?.key, 'before');
// courtesy sent -> quiet until due day
eq('quiet after courtesy sent', nextStep(DUE, ['before'], noon(2026, 6, 17)), null);
eq('due-today fires', nextStep(DUE, ['before'], noon(2026, 6, 19))?.key, 'due');
// invoice entered when already 8 days late: earlier steps are skipped, not replayed
eq('late entry skips to latest', nextStep(DUE, [], noon(2026, 6, 27))?.key, 'overdue7');
// sent overdue7 at day 8; day 10 stays quiet; day 14 escalates
eq('quiet between rungs', nextStep(DUE, ['overdue7'], noon(2026, 6, 29)), null);
eq('escalates at day 14', nextStep(DUE, ['overdue7'], noon(2026, 7, 2))?.key, 'overdue14');
// ladder never goes backwards even with odd history
eq('never repeats below history', nextStep(DUE, ['overdue14'], noon(2026, 7, 3)), null);
eq('final notice at day 30', nextStep(DUE, ['overdue14'], noon(2026, 7, 18))?.key, 'overdue30');
eq('ladder exhausted', nextStep(DUE, ['overdue30'], noon(2027, 0, 1)), null);

// ---- buckets ----
const NOW = noon(2026, 6, 19);
const inv = (id: string, due: number) => ({ id, dueMs: due });
const buckets = bucketInvoices(
  [
    inv('nextmonth', noon(2026, 7, 12)),
    inv('lastweek', noon(2026, 6, 12)),
    inv('today', noon(2026, 6, 19)),
    inv('yesterday', noon(2026, 6, 18)),
    inv('friday', noon(2026, 6, 24)),
  ],
  NOW,
);
eq('overdue oldest first', buckets.overdue.map((i) => i.id), ['lastweek', 'yesterday']);
eq('due soon includes today', buckets.dueSoon.map((i) => i.id), ['today', 'friday']);
eq('later', buckets.later.map((i) => i.id), ['nextmonth']);

// ---- totals ----
const rows = [
  { status: 'open' as const, amountCents: 10000, dueMs: noon(2026, 6, 12) },
  { status: 'open' as const, amountCents: 5000, dueMs: noon(2026, 6, 25) },
  { status: 'paid' as const, amountCents: 99900, dueMs: noon(2026, 6, 1) },
];
eq('outstanding sums open only', outstandingCents(rows), 15000);
eq('overdue sums past-due open only', overdueCents(rows, NOW), 10000);
eq('shorthand overdue', dueShorthand(noon(2026, 6, 12), NOW), '7d overdue');
eq('shorthand today', dueShorthand(noon(2026, 6, 19), NOW), 'due today');
eq('shorthand future', dueShorthand(noon(2026, 6, 22), NOW), 'due in 3d');

// ---- guards ----
eq('isInvoiceStatus accepts', isInvoiceStatus('written_off'), true);
eq('isInvoiceStatus rejects', isInvoiceStatus('overdue'), false);
eq('isStepKey accepts', isStepKey('overdue14'), true);
eq('isStepKey rejects', isStepKey('overdue60'), false);

// ---- messages ----
const ctx = {
  clientName: 'Acme Studio',
  businessName: 'Simon Creative LLC',
  yourName: 'Simon',
  invoiceNumber: '2026-014',
  amountText: '$1,250.50',
  dueDateText: 'Jul 19, 2026',
  daysOverdue: 7,
};

const before = renderReminder('before', { ...ctx, daysOverdue: -3 });
eq('before subject', before.subject, 'Heads-up: invoice 2026-014 due Jul 19, 2026');
eq('before mentions amount', before.body.includes('$1,250.50'), true);
eq('before signs off', before.body.endsWith('Simon\nSimon Creative LLC'), true);

const due = renderReminder('due', { ...ctx, daysOverdue: 0 });
eq('due subject', due.subject, 'Invoice 2026-014 due today');

const o7 = renderReminder('overdue7', ctx);
eq('overdue7 counts days', o7.body.includes('7 days past due'), true);
eq('overdue7 stays polite', o7.body.includes('Could you let me know'), true);

const final = renderReminder('overdue30', { ...ctx, daysOverdue: 34 });
eq('final subject', final.subject, 'Final notice: invoice 2026-014');
eq('final gives 7-day window', final.body.includes('within the next 7 days'), true);

// blank number and empty signature fall back gracefully
const bare = renderReminder('overdue3', {
  ...ctx, invoiceNumber: '', businessName: '', yourName: '',
});
eq('blank number subject', bare.subject, 'Quick nudge: invoice');
eq('blank number body ref', bare.body.includes('my recent invoice'), true);
// empty signature drops the name line entirely — no "Me" placeholder
eq('empty signature omits sign-off name', bare.body.endsWith('Thanks for your help,'), true);
eq('empty signature has no placeholder', bare.body.includes('Me'), false);

// a name-only signature still signs off (no business line)
const nameOnly = renderReminder('due', { ...ctx, businessName: '', daysOverdue: 0 });
eq('name-only signature', nameOnly.body.endsWith('Best,\nSimon'), true);

// every step renders non-empty for a minimal context
for (const s of STEPS) {
  const m = renderReminder(s.key, ctx);
  eq(`${s.key} renders`, m.subject.length > 0 && m.body.length > 40, true);
}

// ---- mailto ----
const url = mailtoUrl('dana@acme.test', 'Invoice A & B', 'Hi,\nline two');
eq('mailto shape', url.startsWith('mailto:dana%40acme.test?subject='), true);
eq('mailto encodes &', url.includes('Invoice%20A%20%26%20B'), true);
eq('mailto encodes newline', url.includes('Hi%2C%0Aline%20two'), true);

console.log(failures ? `\n${failures} FAILED` : '\nall model tests passed');
process.exit(failures ? 1 : 0);
