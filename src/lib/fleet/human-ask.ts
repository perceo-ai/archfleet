// A run can stop and ask a human for anything: a code, a choice, an approval, a
// corrected value, a file name — not just "someone go finish the login".
//
// The ask is data, so the same UI renders every case and the answer flows back
// into the run: plain answers become run params (`{{param.x}}`), answers marked
// secret become run-scoped secrets (`{{secret.x}}`, redacted from every log).
//
// Pure module: no db, no React. The API route and the UI both use it.

export type AskFieldType =
  | "text"
  | "textarea"
  | "password"
  | "code"
  | "number"
  | "url"
  | "email";

export type AskField = {
  /** Param/secret name the answer lands in — how later nodes reference it. */
  name: string;
  label: string;
  type: AskFieldType;
  placeholder?: string;
  /** Store as a run-scoped secret instead of a param. Never logged. */
  secret?: boolean;
  /** Blank answers are rejected unless this is explicitly false. */
  required?: boolean;
  /** Fixed set of answers — renders as a picker rather than a free field. */
  options?: string[];
};

export type AskOption = {
  value: string;
  label: string;
  /** Colours the button; "danger" for destructive choices. */
  tone?: "ok" | "danger" | "neutral";
};

export type AskKind = "input" | "choice" | "approval" | "acknowledge";

export type HumanAsk = {
  kind: AskKind;
  /** The question in the agent's own words. */
  question: string;
  /** What it tried, what it saw — context for the person answering. */
  detail?: string;
  /** input: the values it needs back. */
  fields?: AskField[];
  /** choice/approval: what it can be told to do. */
  options?: AskOption[];
  /** Param name the chosen option lands in (choice only). Defaults to "choice". */
  answerName?: string;
};

export const APPROVAL_OPTIONS: AskOption[] = [
  { value: "approved", label: "Approve", tone: "ok" },
  { value: "rejected", label: "Reject", tone: "danger" },
];

/** An ask for a run that paused without saying what it needs. */
export function acknowledgeAsk(question: string, detail?: string): HumanAsk {
  return { kind: "acknowledge", question, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseField(raw: unknown): AskField | undefined {
  if (!isRecord(raw)) return undefined;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || !/^[a-zA-Z0-9_.-]+$/.test(name)) return undefined;
  const type = typeof raw.type === "string" ? raw.type : "text";
  return {
    name,
    label: typeof raw.label === "string" && raw.label ? raw.label : name,
    type: (["text", "textarea", "password", "code", "number", "url", "email"] as string[]).includes(type)
      ? (type as AskFieldType)
      : "text",
    placeholder: typeof raw.placeholder === "string" ? raw.placeholder : undefined,
    secret: raw.secret === true,
    required: raw.required !== false,
    options: Array.isArray(raw.options)
      ? raw.options.filter((o): o is string => typeof o === "string")
      : undefined,
  };
}

function parseOption(raw: unknown): AskOption | undefined {
  if (typeof raw === "string") return { value: raw, label: raw };
  if (!isRecord(raw) || typeof raw.value !== "string") return undefined;
  const tone = raw.tone;
  return {
    value: raw.value,
    label: typeof raw.label === "string" ? raw.label : raw.value,
    tone: tone === "ok" || tone === "danger" ? tone : undefined,
  };
}

/** Accept an ask from anywhere (node config, an agent's API call, stored JSON)
 * and return something the UI can always render. Junk in, sane ask out. */
export function parseAsk(raw: unknown, fallbackQuestion = "This run needs a human."): HumanAsk {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return acknowledgeAsk(fallbackQuestion);
    // A bare string may still be JSON from a node config field.
    if (trimmed.startsWith("{")) {
      try {
        return parseAsk(JSON.parse(trimmed), fallbackQuestion);
      } catch {
        return acknowledgeAsk(trimmed);
      }
    }
    return acknowledgeAsk(trimmed);
  }
  if (!isRecord(raw)) return acknowledgeAsk(fallbackQuestion);

  const question =
    typeof raw.question === "string" && raw.question.trim()
      ? raw.question.trim()
      : typeof raw.prompt === "string" && raw.prompt.trim()
        ? raw.prompt.trim()
        : fallbackQuestion;
  const detail = typeof raw.detail === "string" && raw.detail.trim() ? raw.detail.trim() : undefined;

  const fields = Array.isArray(raw.fields)
    ? raw.fields.map(parseField).filter((f): f is AskField => !!f)
    : [];
  const options = Array.isArray(raw.options)
    ? raw.options.map(parseOption).filter((o): o is AskOption => !!o)
    : [];

  const declared = typeof raw.kind === "string" ? raw.kind : undefined;
  const kind: AskKind =
    declared === "approval"
      ? "approval"
      : declared === "choice" || (!declared && options.length > 0)
        ? "choice"
        : declared === "input" || (!declared && fields.length > 0)
          ? "input"
          : "acknowledge";

  if (kind === "input") {
    if (fields.length === 0) return acknowledgeAsk(question, detail);
    return { kind, question, detail, fields };
  }
  if (kind === "choice") {
    if (options.length === 0) return acknowledgeAsk(question, detail);
    return {
      kind,
      question,
      detail,
      options,
      answerName: typeof raw.answerName === "string" ? raw.answerName : "choice",
    };
  }
  if (kind === "approval") {
    return {
      kind,
      question,
      detail,
      options: options.length ? options : APPROVAL_OPTIONS,
      answerName: typeof raw.answerName === "string" ? raw.answerName : "approval",
    };
  }
  return acknowledgeAsk(question, detail);
}

/** Missing/invalid answers, as messages to show next to the form. */
export function validateAnswers(ask: HumanAsk, answers: Record<string, string>): string[] {
  const errors: string[] = [];
  if (ask.kind === "input") {
    for (const field of ask.fields ?? []) {
      const value = (answers[field.name] ?? "").trim();
      if (!value) {
        if (field.required !== false) errors.push(`${field.label} is required.`);
        continue;
      }
      if (field.type === "number" && Number.isNaN(Number(value))) {
        errors.push(`${field.label} must be a number.`);
      }
      if (field.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        errors.push(`${field.label} must be an email address.`);
      }
      if (field.type === "url" && !/^https?:\/\/\S+$/i.test(value)) {
        errors.push(`${field.label} must be a URL.`);
      }
      if (field.options?.length && !field.options.includes(value)) {
        errors.push(`${field.label} must be one of: ${field.options.join(", ")}.`);
      }
    }
  }
  if (ask.kind === "choice" || ask.kind === "approval") {
    const name = ask.answerName ?? (ask.kind === "approval" ? "approval" : "choice");
    const chosen = answers[name];
    const allowed = (ask.options ?? []).map((o) => o.value);
    if (!chosen) errors.push("Pick one of the options.");
    else if (allowed.length && !allowed.includes(chosen)) errors.push(`"${chosen}" is not one of the options.`);
  }
  return errors;
}

/** Split answers into what the run can see openly and what must be encrypted. */
export function splitAnswers(
  ask: HumanAsk,
  answers: Record<string, string>,
): { params: Record<string, string>; secrets: Record<string, string> } {
  const params: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const secretNames = new Set((ask.fields ?? []).filter((f) => f.secret).map((f) => f.name));
  const known =
    ask.kind === "input"
      ? new Set((ask.fields ?? []).map((f) => f.name))
      : new Set([ask.answerName ?? (ask.kind === "approval" ? "approval" : "choice")]);

  for (const [name, value] of Object.entries(answers)) {
    if (!known.has(name)) continue;
    if (secretNames.has(name)) secrets[name] = value;
    else params[name] = value;
  }
  return { params, secrets };
}

/** One-line summary of what was answered, for the run record. Secrets are
 * recorded as having been supplied, never as their value. */
export function summarizeAnswers(ask: HumanAsk, answers: Record<string, string>): string {
  const { params, secrets } = splitAnswers(ask, answers);
  const parts = [
    ...Object.entries(params).map(([name, value]) => `${name}=${value}`),
    ...Object.keys(secrets).map((name) => `${name}=(supplied)`),
  ];
  return parts.length ? parts.join(", ") : "acknowledged";
}
