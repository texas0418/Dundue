// src/messages.ts
// Pure module (no expo imports): the six reminder templates, one per ladder
// step. The whole product is that these stay genuinely polite while the ask
// gets steadily harder to ignore — courtesy note, due-today note, nudge,
// follow-up, second follow-up, final notice. Rendered to plain text so they
// paste cleanly into any email client via mailto: or the share sheet.

import type { StepKey } from './models';

export interface MessageContext {
  clientName: string;
  businessName: string; // '' allowed; signature collapses
  yourName: string; // '' allowed
  invoiceNumber: string; // '' allowed; templates fall back to "my recent invoice"
  amountText: string; // already formatted with the currency symbol
  dueDateText: string; // e.g. "Jul 19, 2026"
  daysOverdue: number; // negative before the due date
}

export interface ReminderMessage {
  subject: string;
  body: string;
}

const signature = (ctx: MessageContext): string =>
  [ctx.yourName.trim(), ctx.businessName.trim()].filter(Boolean).join('\n') ||
  'Me';

const invoiceRef = (ctx: MessageContext): string =>
  ctx.invoiceNumber.trim() ? `invoice ${ctx.invoiceNumber.trim()}` : 'my recent invoice';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const greeting = (ctx: MessageContext): string =>
  `Hi ${ctx.clientName.trim() || 'there'},`;

export function renderReminder(
  step: StepKey,
  ctx: MessageContext,
): ReminderMessage {
  const ref = invoiceRef(ctx);
  const numTag = ctx.invoiceNumber.trim() ? ` ${ctx.invoiceNumber.trim()}` : '';
  const hi = greeting(ctx);
  const sig = signature(ctx);
  const days = ctx.daysOverdue;

  switch (step) {
    case 'before':
      return {
        subject: `Heads-up: invoice${numTag} due ${ctx.dueDateText}`,
        body:
          `${hi}\n\n` +
          `Just a friendly heads-up that ${ref} for ${ctx.amountText} is due on ` +
          `${ctx.dueDateText}. No action needed if payment is already on its way.\n\n` +
          `Thanks so much,\n${sig}`,
      };
    case 'due':
      return {
        subject: `Invoice${numTag} due today`,
        body:
          `${hi}\n\n` +
          `A quick note that ${ref} for ${ctx.amountText} is due today, ` +
          `${ctx.dueDateText}. If you've already sent payment, please disregard ` +
          `this — and thank you!\n\n` +
          `Best,\n${sig}`,
      };
    case 'overdue3':
      return {
        subject: `Quick nudge: invoice${numTag}`,
        body:
          `${hi}\n\n` +
          `I hope you're well! This is a gentle nudge about ${ref} for ` +
          `${ctx.amountText}, which was due on ${ctx.dueDateText}. If payment is ` +
          `already on its way, feel free to ignore this.\n\n` +
          `Thanks for your help,\n${sig}`,
      };
    case 'overdue7':
      return {
        subject: `Following up on invoice${numTag}`,
        body:
          `${hi}\n\n` +
          `Following up on ${ref} for ${ctx.amountText}, now ${days} days past ` +
          `due (it was due ${ctx.dueDateText}). Could you let me know when I can ` +
          `expect payment? Happy to resend the invoice if that would help.\n\n` +
          `Thank you,\n${sig}`,
      };
    case 'overdue14':
      return {
        subject: `Invoice${numTag} — ${days} days past due`,
        body:
          `${hi}\n\n` +
          `I wanted to check in again on ${ref} for ${ctx.amountText}, which is ` +
          `now ${days} days past due. Please let me know the status of this ` +
          `payment, or a date I can expect it by. If there's any issue with the ` +
          `invoice itself, I'm glad to sort it out.\n\n` +
          `Kind regards,\n${sig}`,
      };
    case 'overdue30':
      return {
        subject: `Final notice: invoice${numTag}`,
        body:
          `${hi}\n\n` +
          `${cap(ref)} for ${ctx.amountText} is now ${days} days past due, ` +
          `despite earlier reminders. Please arrange payment within the next ` +
          `7 days. If payment has already been sent, let me know so I can update ` +
          `my records; otherwise I may need to pause further work until the ` +
          `balance is settled.\n\n` +
          `Regards,\n${sig}`,
      };
  }
}

/** mailto: URL that opens the user's mail app with everything prefilled.
 *  encodeURIComponent (not +) so spaces and newlines survive every client. */
export function mailtoUrl(
  to: string,
  subject: string,
  body: string,
): string {
  return (
    `mailto:${encodeURIComponent(to.trim())}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}
