// RFC 6238 TOTP — generate the current authenticator code from a base32 seed at
// runtime, so a workflow can pass app-based 2FA. The seed is stored as an
// encrypted secret; a prompt references {{totp.seed_name}} (see templating.ts).

import { createHmac } from "node:crypto";

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error(`invalid base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

export type TotpOptions = {
  timeMs?: number; // default: now
  digits?: number; // default 6
  period?: number; // seconds, default 30
  algorithm?: "sha1" | "sha256" | "sha512"; // default sha1
};

export function generateTotp(base32Secret: string, opts: TotpOptions = {}): string {
  const digits = opts.digits ?? 6;
  const period = opts.period ?? 30;
  const timeMs = opts.timeMs ?? Date.now();
  let counter = Math.floor(timeMs / 1000 / period);

  const key = base32Decode(base32Secret);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = createHmac(opts.algorithm ?? "sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, "0");
}
