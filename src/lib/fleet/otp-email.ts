// Email OTP data source — read a recent message from an inbox and extract the
// one-time code, so a workflow can pass email-based 2FA at runtime. IMAP is done
// via an injected message fetcher, so extraction + orchestration are unit tested
// without a live mailbox.

export type EmailOtpConfig = {
  host: string;
  port?: number;
  secure?: boolean;
  user: string;
  pass: string;
  mailbox?: string; // default INBOX
  fromContains?: string; // filter by sender
  subjectContains?: string; // filter by subject
  regex?: string; // code pattern; default: a standalone 4-8 digit run
  sinceSeconds?: number; // only consider mail newer than this (default 600)
  param?: string; // run param to store the code under (default "otp")
};

/** Pull the first code matching `pattern` (default 4-8 digits) from a body. */
export function extractOtp(text: string, pattern?: string): string | null {
  const re = pattern ? new RegExp(pattern) : /\b(\d{4,8})\b/;
  const m = text.match(re);
  if (!m) return null;
  return m[1] ?? m[0];
}

export type EmailMessage = { from: string; subject: string; text: string; date: number };

/** Given the recent messages (newest first), return the first extractable code
 * from a message matching the filters. Pure — the IMAP fetch is injected. */
export function pickOtpFromMessages(messages: EmailMessage[], config: EmailOtpConfig): string | null {
  const from = config.fromContains?.toLowerCase();
  const subj = config.subjectContains?.toLowerCase();
  for (const msg of messages) {
    if (from && !msg.from.toLowerCase().includes(from)) continue;
    if (subj && !msg.subject.toLowerCase().includes(subj)) continue;
    const code = extractOtp(msg.text, config.regex) ?? extractOtp(msg.subject, config.regex);
    if (code) return code;
  }
  return null;
}

/** Fetcher of recent message bodies (newest first). Injected so IMAP stays out of
 * the tested path. */
export type MessageFetcher = (config: EmailOtpConfig) => Promise<EmailMessage[]>;

export async function fetchEmailOtp(config: EmailOtpConfig, fetcher: MessageFetcher): Promise<string | null> {
  const messages = await fetcher(config);
  return pickOtpFromMessages(messages, config);
}
