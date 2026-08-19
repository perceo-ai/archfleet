// The expression language behind conditions, switches, waits and computed
// params. A small hand-written parser + evaluator: no `eval`, no `Function`,
// no property access that could reach a prototype — a workflow author is not
// necessarily someone you want running arbitrary JS on the controller.
//
//   steps["Fetch invoices"].body.total > 0 && params.region == "eu"
//   contains(lower(steps.Sign_in.stdout), "welcome")
//   default(params.attempts, 0) + 1
//
// Values are plain JSON. Missing paths evaluate to null rather than throwing, so
// a rule about data that has not arrived yet is simply false.

export type ExprValue = string | number | boolean | null | ExprValue[] | { [k: string]: ExprValue };

export type ExprContext = Record<string, ExprValue>;

export class ExprError extends Error {}

/* ------------------------------------------------------------------ lexer */

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "end" };

const OPERATORS = [
  "===",
  "!==",
  "==",
  "!=",
  ">=",
  "<=",
  "&&",
  "||",
  "?",
  ":",
  "(",
  ")",
  "[",
  "]",
  ",",
  ".",
  ">",
  "<",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
];

function lex(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let value = "";
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < src.length) {
          const next = src[++i];
          value += next === "n" ? "\n" : next === "t" ? "\t" : next;
        } else value += src[i];
        i++;
      }
      if (i >= src.length) throw new ExprError("unterminated string");
      i++;
      out.push({ t: "str", v: value });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let raw = "";
      while (i < src.length && /[0-9.]/.test(src[i])) raw += src[i++];
      const num = Number(raw);
      if (Number.isNaN(num)) throw new ExprError(`bad number "${raw}"`);
      out.push({ t: "num", v: num });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let name = "";
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) name += src[i++];
      out.push({ t: "id", v: name });
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`unexpected character "${c}"`);
    i += op.length;
    out.push({ t: "op", v: op });
  }
  out.push({ t: "end" });
  return out;
}

/* ----------------------------------------------------------------- parser */

type Node =
  | { k: "lit"; v: ExprValue }
  | { k: "ref"; name: string }
  | { k: "member"; on: Node; name: Node }
  | { k: "call"; name: string; args: Node[] }
  | { k: "unary"; op: string; on: Node }
  | { k: "binary"; op: string; left: Node; right: Node }
  | { k: "cond"; test: Node; yes: Node; no: Node };

// Higher binds tighter.
const BINDING: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "===": 3,
  "!=": 3,
  "!==": 3,
  ">": 4,
  ">=": 4,
  "<": 4,
  "<=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

function parse(tokens: Token[]): Node {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (op: string) => {
    const token = tokens[pos];
    if (token.t !== "op" || token.v !== op) throw new ExprError(`expected "${op}"`);
    pos++;
  };
  const isOp = (op: string) => {
    const token = tokens[pos];
    return token.t === "op" && token.v === op;
  };

  function parsePrimary(): Node {
    const token = peek();
    if (token.t === "num" || token.t === "str") {
      pos++;
      return { k: "lit", v: token.v };
    }
    if (token.t === "id") {
      pos++;
      if (token.v === "true") return { k: "lit", v: true };
      if (token.v === "false") return { k: "lit", v: false };
      if (token.v === "null") return { k: "lit", v: null };
      if (isOp("(")) {
        pos++;
        const args: Node[] = [];
        if (!isOp(")")) {
          args.push(parseExpr(0));
          while (isOp(",")) {
            pos++;
            args.push(parseExpr(0));
          }
        }
        eat(")");
        return { k: "call", name: token.v, args };
      }
      return { k: "ref", name: token.v };
    }
    if (token.t === "op" && token.v === "(") {
      pos++;
      const inner = parseExpr(0);
      eat(")");
      return inner;
    }
    if (token.t === "op" && (token.v === "!" || token.v === "-")) {
      pos++;
      return { k: "unary", op: token.v, on: parseUnaryTarget() };
    }
    throw new ExprError("unexpected end of expression");
  }

  function parseUnaryTarget(): Node {
    return parsePostfix(parsePrimary());
  }

  function parsePostfix(base: Node): Node {
    let node = base;
    for (;;) {
      if (isOp(".")) {
        pos++;
        const token = peek();
        if (token.t !== "id") throw new ExprError("expected a name after .");
        pos++;
        node = { k: "member", on: node, name: { k: "lit", v: token.v } };
        continue;
      }
      if (isOp("[")) {
        pos++;
        const index = parseExpr(0);
        eat("]");
        node = { k: "member", on: node, name: index };
        continue;
      }
      return node;
    }
  }

  function parseExpr(minBinding: number): Node {
    let left = parsePostfix(parsePrimary());
    for (;;) {
      const token = peek();
      if (token.t !== "op") break;
      if (token.v === "?" && minBinding === 0) {
        pos++;
        const yes = parseExpr(0);
        eat(":");
        const no = parseExpr(0);
        left = { k: "cond", test: left, yes, no };
        continue;
      }
      const binding = BINDING[token.v];
      if (!binding || binding < minBinding) break;
      pos++;
      const right = parseExpr(binding + 1);
      left = { k: "binary", op: token.v, left, right };
    }
    return left;
  }

  const result = parseExpr(0);
  if (peek().t !== "end") throw new ExprError("unexpected trailing input");
  return result;
}

/* -------------------------------------------------------------- functions */

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function truthy(value: ExprValue): boolean {
  if (value === null || value === false) return false;
  if (value === "" || value === 0) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function asString(value: ExprValue): string {
  if (value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function asNumber(value: ExprValue): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

const FUNCTIONS: Record<string, (args: ExprValue[]) => ExprValue> = {
  len: ([a]) =>
    a === null ? 0 : Array.isArray(a) ? a.length : typeof a === "object" ? Object.keys(a).length : asString(a).length,
  lower: ([a]) => asString(a).toLowerCase(),
  upper: ([a]) => asString(a).toUpperCase(),
  trim: ([a]) => asString(a).trim(),
  contains: ([a, b]) =>
    Array.isArray(a) ? a.some((x) => x === b) : asString(a).includes(asString(b)),
  startsWith: ([a, b]) => asString(a).startsWith(asString(b)),
  endsWith: ([a, b]) => asString(a).endsWith(asString(b)),
  matches: ([a, b]) => {
    try {
      return new RegExp(asString(b)).test(asString(a));
    } catch {
      return false;
    }
  },
  number: ([a]) => {
    const n = asNumber(a);
    return Number.isNaN(n) ? null : n;
  },
  string: ([a]) => asString(a),
  bool: ([a]) => truthy(a),
  /** First argument that is not null/missing. */
  default: (args) => args.find((a) => a !== null && a !== undefined) ?? null,
  /** True when a path resolved to something. */
  has: ([a]) => a !== null && a !== undefined,
  json: ([a]) => {
    try {
      return JSON.parse(asString(a)) as ExprValue;
    } catch {
      return null;
    }
  },
  round: ([a]) => Math.round(asNumber(a)),
  abs: ([a]) => Math.abs(asNumber(a)),
  min: (args) => Math.min(...args.map(asNumber)),
  max: (args) => Math.max(...args.map(asNumber)),
  split: ([a, b]) => asString(a).split(asString(b)),
  join: ([a, b]) => (Array.isArray(a) ? a.map(asString).join(asString(b)) : asString(a)),
  replace: ([a, b, c]) => asString(a).split(asString(b)).join(asString(c)),
};

/* -------------------------------------------------------------- evaluator */

function evaluate(node: Node, ctx: ExprContext): ExprValue {
  switch (node.k) {
    case "lit":
      return node.v;
    case "ref":
      return node.name in ctx ? ctx[node.name] : null;
    case "member": {
      const target = evaluate(node.on, ctx);
      if (target === null || typeof target !== "object") return null;
      const key = asString(evaluate(node.name, ctx));
      if (UNSAFE_KEYS.has(key)) return null;
      if (Array.isArray(target)) {
        const index = Number(key);
        return Number.isInteger(index) && index >= 0 && index < target.length ? target[index] : null;
      }
      return Object.prototype.hasOwnProperty.call(target, key) ? target[key] : null;
    }
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new ExprError(`unknown function "${node.name}"`);
      return fn(node.args.map((a) => evaluate(a, ctx)));
    }
    case "unary": {
      const value = evaluate(node.on, ctx);
      return node.op === "!" ? !truthy(value) : -asNumber(value);
    }
    case "cond":
      return truthy(evaluate(node.test, ctx)) ? evaluate(node.yes, ctx) : evaluate(node.no, ctx);
    case "binary": {
      // Short-circuit before evaluating the right side.
      if (node.op === "&&") {
        const left = evaluate(node.left, ctx);
        return truthy(left) ? evaluate(node.right, ctx) : left;
      }
      if (node.op === "||") {
        const left = evaluate(node.left, ctx);
        return truthy(left) ? left : evaluate(node.right, ctx);
      }
      const a = evaluate(node.left, ctx);
      const b = evaluate(node.right, ctx);
      switch (node.op) {
        case "==":
        case "===":
          return looseEquals(a, b);
        case "!=":
        case "!==":
          return !looseEquals(a, b);
        case ">":
          return compare(a, b) > 0;
        case ">=":
          return compare(a, b) >= 0;
        case "<":
          return compare(a, b) < 0;
        case "<=":
          return compare(a, b) <= 0;
        case "+": {
          // Params arrive as strings, so `params.attempts + 1` must add. Two
          // strings still concatenate — "5" + "5" is "55", not 10.
          const numeric = typeof a === "number" || typeof b === "number";
          const na = asNumber(a);
          const nb = asNumber(b);
          if (numeric && !Number.isNaN(na) && !Number.isNaN(nb)) return na + nb;
          return asString(a) + asString(b);
        }
        case "-":
          return asNumber(a) - asNumber(b);
        case "*":
          return asNumber(a) * asNumber(b);
        case "/":
          return asNumber(b) === 0 ? null : asNumber(a) / asNumber(b);
        case "%":
          return asNumber(b) === 0 ? null : asNumber(a) % asNumber(b);
        default:
          throw new ExprError(`unknown operator "${node.op}"`);
      }
    }
  }
}

/** "2" == 2 is true — workflow values arrive as strings from forms and params. */
function looseEquals(a: ExprValue, b: ExprValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  if (typeof a === "number" || typeof b === "number") {
    const na = asNumber(a);
    const nb = asNumber(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  return asString(a) === asString(b);
}

function compare(a: ExprValue, b: ExprValue): number {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
  const sa = asString(a);
  const sb = asString(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

const cache = new Map<string, Node>();

/** Parse (memoised) and evaluate. Throws ExprError on a malformed expression —
 * callers decide whether that fails the node or just reads as false. */
export function evalExpr(source: string, ctx: ExprContext): ExprValue {
  let ast = cache.get(source);
  if (!ast) {
    ast = parse(lex(source));
    if (cache.size > 500) cache.clear();
    cache.set(source, ast);
  }
  return evaluate(ast, ctx);
}

/** Evaluate as a rule. A malformed or unresolvable expression is false, never a
 * crash mid-run — the reason comes back for the event log. */
export function evalRule(
  source: string,
  ctx: ExprContext,
): { value: boolean; error?: string } {
  try {
    return { value: truthy(evalExpr(source, ctx)) };
  } catch (e) {
    return { value: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Syntax check for the editor — no context needed. */
export function checkExpr(source: string): string | undefined {
  try {
    parse(lex(source));
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export const EXPR_FUNCTIONS = Object.keys(FUNCTIONS).sort();
