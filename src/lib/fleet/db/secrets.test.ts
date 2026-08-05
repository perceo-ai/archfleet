import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { decryptSecret, encryptSecret, loadKey } from "./crypto";
import { listSecretMeta, loadSecrets, saveSecret } from "./secrets-repo";

const KEY = loadKey({ CUF_SECRET_KEY: "test-master-key" });

describe("crypto", () => {
  it("round-trips a value", () => {
    const ct = encryptSecret("swordfish", KEY);
    expect(ct).not.toContain("swordfish");
    expect(decryptSecret(ct, KEY)).toBe("swordfish");
  });

  it("produces a fresh IV each time (ciphertext differs)", () => {
    expect(encryptSecret("x", KEY)).not.toBe(encryptSecret("x", KEY));
  });

  it("fails to decrypt with the wrong key (GCM integrity)", () => {
    const ct = encryptSecret("x", KEY);
    const wrong = loadKey({ CUF_SECRET_KEY: "other" });
    expect(() => decryptSecret(ct, wrong)).toThrow();
  });

  it("refuses to load a key when env is unset", () => {
    expect(() => loadKey({})).toThrow(/CUF_SECRET_KEY/);
  });
});

describe("secrets repo", () => {
  it("stores ciphertext, never plaintext, and decrypts on load", () => {
    const db = openDb(":memory:");
    saveSecret(db, { name: "portal_password", scope: "workflow", value: "swordfish" }, KEY);

    const rawRow = db.prepare("SELECT encrypted_value FROM cuf_secrets").get() as { encrypted_value: string };
    expect(rawRow.encrypted_value).not.toContain("swordfish");

    const secrets = loadSecrets(db, KEY);
    expect(secrets[0].name).toBe("portal_password");
    expect(secrets[0].value).toBe("swordfish");
    db.close();
  });

  it("listSecretMeta never returns values", () => {
    const db = openDb(":memory:");
    saveSecret(db, { name: "api_token", scope: "global", value: "topsecret" }, KEY);
    const meta = listSecretMeta(db);
    expect(meta[0]).toEqual({ id: meta[0].id, name: "api_token", scope: "global" });
    expect(JSON.stringify(meta)).not.toContain("topsecret");
    db.close();
  });
});
