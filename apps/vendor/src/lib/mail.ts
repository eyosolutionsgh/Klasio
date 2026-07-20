/**
 * Sending one kind of message: a sign-in code to a member of staff.
 *
 * Deliberately not a mail framework. The portal has exactly one email to send, to an address it
 * already holds, and the whole surface is "did it leave the building".
 *
 * Mirrors the school application's arrangement — a real provider, a mock that only logs, and a
 * production build that refuses the mock unless somebody has said out loud that undelivered mail
 * is acceptable. Silently not sending is the failure worth engineering against: a code that never
 * arrives looks exactly like a code that was wrong.
 */
export interface MailResult {
  ok: boolean;
  detail: string;
}

function config() {
  return {
    token: process.env.MAILERSEND_API_TOKEN || undefined,
    from: process.env.MAILERSEND_FROM_EMAIL || undefined,
    fromName: process.env.MAILERSEND_FROM_NAME || 'Klasio Licensing',
    allowMock: process.env.ALLOW_MOCK_EMAIL === 'true',
  };
}

/**
 * Whether a code can actually reach somebody's inbox.
 *
 * Drives the UI rather than throwing at it: a portal with no mail configured offers the
 * authenticator app and does not dangle an email option that would fail on click.
 */
export function canSendEmail(): boolean {
  const { token, from, allowMock } = config();
  return Boolean((token && from) || (allowMock && process.env.NODE_ENV !== 'production'));
}

export async function sendMail(to: string, subject: string, text: string): Promise<MailResult> {
  const { token, from, fromName, allowMock } = config();

  if (!token || !from) {
    if (process.env.NODE_ENV === 'production' && !allowMock) {
      return { ok: false, detail: 'No mail provider configured on this server.' };
    }
    // Development: say what would have been sent, including the code, because the alternative is
    // a developer who cannot sign in and no way to find out why.
    console.warn(`[mail:mock] to=${to} subject=${subject}\n${text}`);
    return { ok: true, detail: 'Logged to the server console (no mail provider configured).' };
  }

  try {
    const res = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: from, name: fromName },
        to: [{ email: to }],
        subject,
        text,
      }),
    });
    // MailerSend answers 202 with an empty body on success; anything else carries a reason worth
    // keeping, because "it did not send" without a cause is a support call with nowhere to start.
    if (!res.ok) {
      return { ok: false, detail: `Mail provider refused it (${res.status}).` };
    }
    return { ok: true, detail: 'Sent.' };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'Could not reach the mail provider.',
    };
  }
}
