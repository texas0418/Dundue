# Dundue

Invoice follow-up and payment reminders for freelancers and small agencies.
You track the invoices you're waiting on; Dundue tells you exactly when to
nudge and writes the polite email for you — a six-step ladder that escalates
from courtesy heads-up (3 days before due) to final notice (30 days past),
each one a tap away from your mail app or share sheet. Sent reminders are
logged so the ladder never repeats itself and never fires steps it blew past.
Local-first: everything lives in SQLite on the phone, nothing leaves the
device — *you* send every email, from your own address.

Named for dunning — the centuries-old word for pressing payment — plus the
due date it watches: dun + due.

Distinct from Invoicer (which *creates* invoices/PDFs): Dundue is only about
getting existing invoices paid. Natural cross-sell later.

## Stack

House pattern (see DreamFeed/DayPorter): Expo SDK 57, TypeScript strict, no
navigation library, plain StyleSheet. Pure logic in `src/models.ts` (ladder
math, date/money handling), `src/messages.ts` (the six templates + mailto),
`src/dbCore.ts`, `src/backupFormat.ts` — all Node-tested without Expo.

Theming: light and dark palettes in `src/theme.ts`, resolved by `useTheme()`
(Settings: system / light / dark). Urgency colors (overdue / due soon /
upcoming / paid) carry the color coding on cards and section headers.

## Run

```sh
npm install
npm test          # pure-module tests via tsx (ladder, dates, templates, schema, backup)
npx expo start    # everything works in Expo Go (purchases fail open)
```

## Monetization

RevenueCat one-time unlock (`dundue_pro_lifetime`): unlimited invoices after
15 free. Clients, the reminder ladder, composing, and export are free forever
(fail-open house rule — placeholder keys ⇒ Pro unlocked).

## Design decisions

- Reminders are drafts the user sends, not automated email — no backend, no
  deliverability problems, and the "from" address is the user's own. The home
  screen queue is the automation.
- Ladder: −3 / 0 / +3 / +7 / +14 / +30 days vs due. An invoice entered late
  skips straight to the latest applicable step. "Mark sent" (offered
  automatically after Email/Share) is what advances it.
- Dates are typed as YYYY-MM-DD (no date-picker lib), pinned to local noon;
  all comparisons are local-calendar-day, DST-proof (tested).
- Long-press a history entry to un-log a mistaken "mark sent".

## To-dos and bugs

Tracked in [GitHub Issues](https://github.com/texas0418/Dundue/issues) — the
`pre-ship` label is the App Store submission checklist, `tech-debt` items have
inline eslint-disables pointing at them, and `handoff` issues carry
session-to-session notes. See AGENTS.md for the PR/CI workflow.
