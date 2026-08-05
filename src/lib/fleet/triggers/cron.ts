// Minimal, dependency-free 5-field cron evaluator (UTC). Fields:
//   minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6, Sun=0)
// Supports: '*', '*/n', 'a-b', 'a-b/n', comma lists, single values. '7' == Sunday.
//
// Day-of-month / day-of-week follow standard cron: when BOTH are restricted a
// timestamp matches if EITHER matches; otherwise both must match.

type CronSpec = {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
};

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad cron step: ${part}`);

    let lo = min;
    let hi = max;
    if (rangePart !== "*") {
      const [a, b] = rangePart.split("-");
      lo = Number(a);
      hi = b !== undefined ? Number(b) : Number(a);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`bad cron field: ${part}`);
    }
    for (let v = lo; v <= hi; v += step) {
      if (v < min || v > max) throw new Error(`cron value out of range: ${v}`);
      out.add(v);
    }
  }
  return out;
}

export function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron must have 5 fields, got ${fields.length}`);
  const [m, h, dom, mon, dowRaw] = fields;
  const dow = parseField(dowRaw, 0, 7);
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0); // normalize Sunday
  }
  return {
    minute: parseField(m, 0, 59),
    hour: parseField(h, 0, 23),
    dom: parseField(dom, 1, 31),
    month: parseField(mon, 1, 12),
    dow,
    domRestricted: dom !== "*",
    dowRestricted: dowRaw !== "*",
  };
}

function matches(date: Date, spec: CronSpec): boolean {
  if (!spec.minute.has(date.getUTCMinutes())) return false;
  if (!spec.hour.has(date.getUTCHours())) return false;
  if (!spec.month.has(date.getUTCMonth() + 1)) return false;
  const domOk = spec.dom.has(date.getUTCDate());
  const dowOk = spec.dow.has(date.getUTCDay());
  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

/**
 * Next UTC time strictly after `from` that matches the expression, as an ISO
 * string. Scans minute-by-minute up to ~400 days; returns null if none found.
 */
export function nextRun(expr: string, from: Date): string | null {
  const spec = parseCron(expr);
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1); // strictly after
  const limit = 400 * 24 * 60; // minutes
  for (let i = 0; i < limit; i++) {
    if (matches(d, spec)) return d.toISOString();
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
}
