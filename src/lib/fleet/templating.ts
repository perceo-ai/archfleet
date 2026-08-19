// Resolve {{secret.NAME}} and {{param.NAME}} placeholders in a node prompt so a
// workflow can reference a stored password/URL without hardcoding it.
//
// SECURITY NOTE: a computer-use agent must *type* a password, so a resolved
// secret necessarily reaches the guest (and, for the planner step, the model).
// We therefore (a) resolve as late as possible (per node, on execution) and
// (b) always redact the value from persisted logs/events (see redaction.ts).
// Prefer params for anything non-sensitive.

import { generateTotp } from "./totp";
import { evalExpr, type ExprContext, type ExprValue } from "./expr";

export type TemplateValues = {
  secrets: Record<string, string>;
  params: Record<string, string | number | boolean | null>;
  /** A custom node's own inputs, referenced as {{field.x}}. */
  fields?: Record<string, string>;
  /** Everything an expression can see: params, steps, run. Enables {{= ... }}. */
  context?: ExprContext;
};

// {{secret.x}}, {{param.x}}, {{field.x}}, or {{totp.x}} (x = a secret holding a
// base32 TOTP seed).
const PLACEHOLDER = /\{\{\s*(secret|param|totp|field)\.([a-zA-Z0-9_.-]+)\s*\}\}/g;

// {{= expression }} — the general form: anything the rules engine can evaluate,
// e.g. {{= steps["Fetch"].body.total > 1000 ? "large" : "small" }}.
const EXPRESSION = /\{\{=\s*([\s\S]+?)\s*\}\}/g;

function renderValue(value: ExprValue): string {
  if (value === null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function resolveTemplate(text: string, values: TemplateValues): string {
  const withExpressions = values.context
    ? text.replace(EXPRESSION, (whole, source: string) => {
        try {
          return renderValue(evalExpr(source, values.context!));
        } catch {
          return whole; // leave a broken expression visible rather than blanking it
        }
      })
    : text;
  return withExpressions.replace(PLACEHOLDER, (whole, kind: string, name: string) => {
    if (kind === "field") {
      return values.fields && name in values.fields ? values.fields[name] : whole;
    }
    if (kind === "secret") {
      return name in values.secrets ? values.secrets[name] : whole;
    }
    if (kind === "totp") {
      // Live authenticator code from the secret seed named `name`.
      if (!(name in values.secrets)) return whole;
      try {
        return generateTotp(values.secrets[name]);
      } catch {
        return whole;
      }
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
