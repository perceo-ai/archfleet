// Reading and writing operator configuration.
//
// Plain values go in cuf_settings; anything the catalogue marks `secret` goes to
// the encrypted secret store under the same key, so an API key is never sitting
// in a readable table (and never leaves the server).

import type { Db } from "./db";
import { loadSecrets, saveSecret } from "./secrets-repo";
import {
  SETTING_DEFS,
  asBoolean,
  asNumber,
  isSecretSetting,
  resolveSetting,
  settingSource,
} from "../settings";

/** Stored plain values, keyed by setting key. */
export function storedSettings(db: Db): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM cuf_settings").all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Secret settings that have a value, by key. Values are decrypted here and must
 * not leave the server process. */
function storedSecretSettings(db: Db): Record<string, string> {
  try {
    const wanted = new Set(SETTING_DEFS.filter((d) => d.kind === "secret").map((d) => d.key));
    return Object.fromEntries(
      loadSecrets(db)
        .filter((s) => wanted.has(s.name))
        .map((s) => [s.name, s.value]),
    );
  } catch {
    // No CUF_SECRET_KEY: secret settings simply are not available.
    return {};
  }
}

/** Everything, resolved: stored value, else environment, else default. */
export function effectiveSettings(
  db: Db,
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const stored = { ...storedSettings(db), ...storedSecretSettings(db) };
  return Object.fromEntries(
    SETTING_DEFS.map((d) => [d.key, resolveSetting(d.key, stored, env)]),
  );
}

export function settingValue(
  db: Db,
  key: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const stored = isSecretSetting(key) ? storedSecretSettings(db) : storedSettings(db);
  return resolveSetting(key, stored, env);
}

export const settingFlag = (db: Db, key: string): boolean => asBoolean(settingValue(db, key));

export const settingNumber = (db: Db, key: string, fallback: number): number =>
  asNumber(settingValue(db, key), fallback);

/** What the UI shows: the value for plain settings, whether one is set for
 * secrets, and where each is coming from. */
export function settingsForDisplay(
  db: Db,
  env: Record<string, string | undefined> = process.env,
): { key: string; value: string; isSet: boolean; source: string }[] {
  const stored = storedSettings(db);
  const secrets = storedSecretSettings(db);
  return SETTING_DEFS.map((d) => {
    const all = { ...stored, ...secrets };
    const resolved = resolveSetting(d.key, all, env);
    return {
      key: d.key,
      // A secret's value never goes to the browser.
      value: d.kind === "secret" ? "" : (resolved ?? ""),
      isSet: resolved != null && resolved !== "",
      source: settingSource(d.key, all, env),
    };
  });
}

export type SaveSettingsReport = {
  /** Keys that were written (or cleared). */
  stored: string[];
  /** Secret settings that could not be encrypted, so were not stored at all.
   * Everything else in the same patch still saved. */
  skippedSecrets: string[];
};

/** Store a patch. An empty string clears a setting, falling back to env/default.
 *
 * A secret with no encryption key configured is skipped and reported — never
 * written in the clear, and never taking the rest of the patch down with it. */
export function saveSettings(
  db: Db,
  patch: Record<string, string>,
  now = new Date().toISOString(),
): SaveSettingsReport {
  const stored: string[] = [];
  const skippedSecrets: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (isSecretSetting(key)) {
      if (value === "") {
        db.prepare("DELETE FROM cuf_secrets WHERE name=? AND scope_type='global'").run(key);
        stored.push(key);
        continue;
      }
      try {
        saveSecret(db, { name: key, scope: "global", value, now });
        stored.push(key);
      } catch {
        skippedSecrets.push(key);
      }
      continue;
    }
    if (value === "") {
      db.prepare("DELETE FROM cuf_settings WHERE key=?").run(key);
      stored.push(key);
      continue;
    }
    db.prepare(
      "INSERT OR REPLACE INTO cuf_settings (key, value, updated_at) VALUES (?,?,?)",
    ).run(key, value, now);
    stored.push(key);
  }
  return { stored, skippedSecrets };
}

/** The behaviour defaults a new automation starts from. */
export function behaviourDefaults(db: Db): {
  retryPolicy?: string;
  takeoverPolicy?: string;
  artifactPolicy?: string;
} {
  return {
    retryPolicy: settingValue(db, "behaviour.retry_policy"),
    takeoverPolicy: settingValue(db, "behaviour.takeover_policy"),
    artifactPolicy: settingValue(db, "behaviour.artifact_policy"),
  };
}
