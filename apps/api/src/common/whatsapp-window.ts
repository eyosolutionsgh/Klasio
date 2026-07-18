/**
 * When the school is allowed to send a WhatsApp message.
 *
 * **The school never opens a conversation.** This is a product decision, not a technical limit,
 * and it is enforced here rather than left to whoever writes the next feature.
 *
 * WhatsApp itself permits business-initiated contact through paid message templates. We do not
 * use them. A parent who has not written to the school has not asked to be reached on WhatsApp,
 * and a school messaging a family unprompted on a personal channel is a different product from
 * the one we are building. Announcements, fee reminders and absence alerts go by SMS, where the
 * parent gave the school their number for exactly that purpose.
 *
 * What remains is the 24-hour customer service window: once a guardian writes in, the business
 * may reply freely for 24 hours. Every outbound message must therefore point at an inbound one.
 * That is the only door, and `canReply` is its lock.
 */

export interface ConversationWindow {
  /** 24h after the guardian's last inbound message. Null when they have never written. */
  windowExpiresAt: Date | null;
}

export type ReplyDecision = { allowed: true; expiresAt: Date } | { allowed: false; reason: string };

/** WhatsApp's customer service window. Fixed by the platform, not by us. */
export const WINDOW_HOURS = 24;

export function windowFromInbound(receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + WINDOW_HOURS * 60 * 60 * 1000);
}

/**
 * May the school send on this conversation right now?
 *
 * Deliberately returns a reason rather than a bare false: the front office needs to be told
 * "she has not written to you" instead of watching a send button do nothing.
 */
export function canReply(conv: ConversationWindow, now: Date = new Date()): ReplyDecision {
  if (!conv.windowExpiresAt) {
    return {
      allowed: false,
      reason:
        'This family has not messaged the school on WhatsApp. The school cannot start a ' +
        'WhatsApp conversation — send an SMS instead.',
    };
  }
  if (conv.windowExpiresAt.getTime() <= now.getTime()) {
    return {
      allowed: false,
      reason:
        'It is more than 24 hours since they last wrote, so WhatsApp will not deliver a reply. ' +
        'Send an SMS, or wait for them to message again.',
    };
  }
  return { allowed: true, expiresAt: conv.windowExpiresAt };
}

/** Minutes of window left, for showing a front-office clock. Zero once closed. */
export function minutesLeft(conv: ConversationWindow, now: Date = new Date()): number {
  if (!conv.windowExpiresAt) return 0;
  return Math.max(0, Math.floor((conv.windowExpiresAt.getTime() - now.getTime()) / 60000));
}
