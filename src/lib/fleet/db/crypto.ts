// App-level secret encryption. Per the design spec, secret values are encrypted
// at rest with a key stored OUTSIDE the database (env CUF_SECRET_KEY). AES-256-GCM
// gives confidentiality + integrity; each value gets a fresh random IV.
//
// Serialized form: base64(iv).base64(authTag).base64(ciphertext)

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALG = "aes-256-gcm";
const IV_BYTES = 12;

/** Derive a 32-byte key from CUF_SECRET_KEY (any length) via sha256. Throws if
 * the env key is missing so we never silently persist unprotected secrets. */
export function loadKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.CUF_SECRET_KEY;
  if (!raw) {
    throw new Error("CUF_SECRET_KEY is not set — refusing to handle secrets without an encryption key.");
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(serialized: string, key: Buffer): string {
  const [ivB64, tagB64, dataB64] = serialized.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed encrypted secret");
  const decipher = createDecipheriv(ALG, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
