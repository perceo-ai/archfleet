import type { Secret } from "./types";

export function redactSecrets(text: string, secrets: Secret[]): string {
  return secrets.reduce((redacted, secret) => {
    if (!secret.value) {
      return redacted;
    }

    return redacted.split(secret.value).join(`[REDACTED:${secret.name}]`);
  }, text);
}
