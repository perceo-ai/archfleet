// Custom node types: how someone adds a node to the palette without touching
// the orchestrator. A definition is data — a name, the inputs it takes, and
// which built-in primitive runs it (an HTTP call, a shell command, or a pure
// expression). The orchestrator compiles it at run time; nothing is generated,
// nothing is eval'd, and a bad definition fails its own node rather than the
// engine.

import { evalExpr, type ExprContext, type ExprValue } from "./expr";

export type NodeFieldType = "text" | "textarea" | "number" | "secret" | "select" | "boolean";

export type NodeTypeField = {
  /** Referenced in the template as {{field.name}}. */
  name: string;
  label: string;
  type: NodeFieldType;
  placeholder?: string;
  required?: boolean;
  /** For select fields. */
  options?: string[];
  default?: string;
};

/** What actually runs. Each maps onto a primitive the engine already has. */
export type NodeTypeBase = "http" | "shell" | "expression";

export type CustomNodeType = {
  id: string;
  name: string;
  description: string;
  /** Lucide icon name, so the graph can show it. Falls back to a generic block. */
  icon?: string;
  base: NodeTypeBase;
  fields: NodeTypeField[];
  /** http: JSON with url/method/headers/body. shell: the command. expression:
   * the expression whose value becomes the node's output. All support
   * {{field.x}}, {{param.x}}, {{secret.x}} and {{= expression }}. */
  template: string;
  /** Expression deciding success; defaults to the primitive's own outcome. */
  successExpr?: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomNodeTypeInput = Omit<CustomNodeType, "createdAt" | "updatedAt"> &
  Partial<Pick<CustomNodeType, "createdAt" | "updatedAt">>;

const NAME_RE = /^[a-zA-Z0-9_.-]+$/;

/** Reasons a definition would not work, in the order an author should fix them. */
export function validateNodeType(type: Partial<CustomNodeType>): string[] {
  const errors: string[] = [];
  if (!type.id?.trim()) errors.push("An id is required.");
  else if (!NAME_RE.test(type.id)) errors.push("The id may only contain letters, numbers, . _ and -.");
  if (!type.name?.trim()) errors.push("A name is required.");
  if (!type.base || !["http", "shell", "expression"].includes(type.base)) {
    errors.push("Pick what runs it: an HTTP call, a shell command, or an expression.");
  }
  if (!type.template?.trim()) errors.push("The template is empty — there is nothing to run.");

  for (const field of type.fields ?? []) {
    if (!field.name?.trim() || !NAME_RE.test(field.name)) {
      errors.push(`Field "${field.name || "(unnamed)"}" needs a name of letters, numbers, . _ or -.`);
    }
    if (field.type === "select" && !(field.options ?? []).length) {
      errors.push(`Field "${field.name}" is a picker with no options.`);
    }
  }

  if (type.base === "http" && type.template) {
    // The template is templated before parsing, so only obvious breakage shows
    // up here — a missing url is the one worth catching early.
    const looksLikeJson = type.template.trim().startsWith("{");
    if (!looksLikeJson) errors.push("An HTTP node's template must be JSON with at least a url.");
    else if (!/"url"\s*:/.test(type.template)) errors.push("The HTTP template has no url.");
  }
  return errors;
}

/** Field values for a node instance, with defaults applied and unknown keys
 * dropped — a node cannot smuggle in inputs its type never declared. */
export function resolveFields(
  type: CustomNodeType,
  values: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of type.fields) {
    const supplied = values?.[field.name];
    out[field.name] = supplied != null && supplied !== "" ? supplied : (field.default ?? "");
  }
  return out;
}

/** Missing required inputs, named so the run event can say which. */
export function missingRequiredFields(
  type: CustomNodeType,
  values: Record<string, string>,
): string[] {
  return type.fields
    .filter((f) => f.required && !String(values[f.name] ?? "").trim())
    .map((f) => f.label || f.name);
}

/** The expression context a custom node sees: the run context plus its own
 * fields, so a template can say `{{= number(field.amount) > 1000 }}`. */
export function fieldContext(ctx: ExprContext, fields: Record<string, string>): ExprContext {
  return { ...ctx, field: fields as unknown as ExprValue };
}

/** Evaluate a definition's success rule. Absent rule = defer to the primitive. */
export function evaluateSuccessExpr(
  type: CustomNodeType,
  ctx: ExprContext,
): boolean | undefined {
  if (!type.successExpr?.trim()) return undefined;
  try {
    const value = evalExpr(type.successExpr, ctx);
    return value !== null && value !== false && value !== 0 && value !== "";
  } catch {
    return false;
  }
}

/** Starting points for the "new node type" form — the shapes people reach for
 * first, so nobody starts from an empty JSON box. */
export const NODE_TYPE_PRESETS: { label: string; hint: string; type: Omit<CustomNodeType, "id" | "createdAt" | "updatedAt"> }[] = [
  {
    label: "Call an API",
    hint: "POST some JSON to a URL and branch on the response.",
    type: {
      name: "Call an API",
      description: "Send an HTTP request and keep the response for later steps.",
      icon: "Cloud",
      base: "http",
      fields: [
        { name: "url", label: "URL", type: "text", required: true, placeholder: "https://api.example.com/things" },
        { name: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"], default: "POST" },
        { name: "body", label: "JSON body", type: "textarea", placeholder: '{"id": "{{param.id}}"}' },
        { name: "token", label: "Bearer token", type: "secret" },
      ],
      template:
        '{"url": "{{field.url}}", "method": "{{field.method}}", "headers": {"content-type": "application/json", "authorization": "Bearer {{field.token}}"}, "body": {{field.body}}}',
    },
  },
  {
    label: "Post to Slack",
    hint: "A webhook post with a message — the classic notify step.",
    type: {
      name: "Post to Slack",
      description: "Send a message to a Slack incoming webhook.",
      icon: "Send",
      base: "http",
      fields: [
        { name: "webhook", label: "Webhook URL", type: "secret", required: true },
        { name: "text", label: "Message", type: "textarea", required: true, placeholder: "Filed {{param.po}}" },
      ],
      template:
        '{"url": "{{field.webhook}}", "method": "POST", "headers": {"content-type": "application/json"}, "body": {"text": "{{field.text}}"}}',
    },
  },
  {
    label: "Run a command",
    hint: "A shell command on the controller, with its output kept.",
    type: {
      name: "Run a command",
      description: "Run a shell command and capture stdout for later steps.",
      icon: "Terminal",
      base: "shell",
      fields: [
        { name: "command", label: "Command", type: "textarea", required: true, placeholder: "ls -la /data/artifacts" },
      ],
      template: "{{field.command}}",
    },
  },
  {
    label: "Compute a value",
    hint: "Pure rule — derive something from earlier steps, no I/O.",
    type: {
      name: "Compute a value",
      description: "Evaluate an expression and keep the result as this step's output.",
      icon: "Sigma",
      base: "expression",
      fields: [
        { name: "expression", label: "Expression", type: "textarea", required: true, placeholder: "steps.Fetch.body.total > 1000" },
      ],
      template: "{{field.expression}}",
    },
  },
];
