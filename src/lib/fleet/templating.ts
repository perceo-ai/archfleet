// Resolve {{secret.NAME}} and {{param.NAME}} placeholders in a node prompt so a
// workflow can reference a stored password/URL without hardcoding it.
//
// SECURITY NOTE: a computer-use agent must *type* a password, so a resolved
// secret necessarily reaches the guest (and, for the planner step, the model).
// We therefore (a) resolve as late as possible (per node, on execution) and
// (b) always redact the value from persisted logs/events (see redaction.ts).
// Prefer params for anything non-sensitive.

export type TemplateValues = {
  secrets: Record<string, string>;
  params: Record<string, string | number | boolean | null>;
};

const PLACEHOLDER = /\{\{\s*(secret|param)\.([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function resolveTemplate(text: string, values: TemplateValues): string {
  return text.replace(PLACEHOLDER, (whole, kind: string, name: string) => {
    if (kind === "secret") {
      return name in values.secrets ? values.secrets[name] : whole;
    }
    return name in values.params ? String(values.params[name]) : whole;
  });
}

/** Names of secrets actually referenced by a template (for scoping/injection). */
export function referencedSecrets(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m[1] === "secret") out.add(m[2]);
  }
  return [...out];
}
