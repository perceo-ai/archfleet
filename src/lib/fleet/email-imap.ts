// Real IMAP fetcher for otp_email nodes (server-side I/O). Connects, reads recent
// messages, and returns the OTP via the pure pickOtpFromMessages logic. Kept out
// of the unit-tested path — the orchestrator is tested with a fake emailOtp.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { pickOtpFromMessages, type EmailMessage, type EmailOtpConfig } from "./otp-email";

export async function fetchEmailOtpImap(config: EmailOtpConfig): Promise<string | null> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port ?? 993,
    secure: config.secure ?? true,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock(config.mailbox ?? "INBOX");
    try {
      const since = new Date(Date.now() - (config.sinceSeconds ?? 600) * 1000);
      const messages: EmailMessage[] = [];
      for await (const msg of client.fetch({ since }, { source: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        messages.push({
          from: parsed.from?.text ?? "",
          subject: parsed.subject ?? "",
          text: parsed.text ?? "",
          date: parsed.date?.getTime() ?? 0,
        });
      }
      messages.sort((a, b) => b.date - a.date); // newest first
      return pickOtpFromMessages(messages, config);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
