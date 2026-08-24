// The running story of what a workflow has done so far, kept small enough to
// survive a long run.
//
// Every node appends what it produced, and that text is fed back into the
// planner prompt and into each computer-use task. As a plain accumulating
// string it grows without bound: a workflow that runs for hours — which is the
// whole point of a long-running automation — eventually sends a context so
// large the model rejects it, or silently truncates the *front*, which is where
// the original goal lives.
//
// So it compacts as it goes. Recent steps stay verbatim because they are what
// the next decision depends on; older ones collapse into a summary that keeps
// the shape of what happened without the detail. Deterministic and model-free —
// compaction that needed a model call would add cost and a failure mode to
// every step, and the thing being compacted is already just short status lines.

/** One node's contribution. */
export type WorkEntry = { node: string; text: string };

export type CompactOptions = {
  /** How many of the most recent entries are always kept word for word. */
  keepVerbatim?: number;
  /** Soft ceiling on the rendered context, in characters. */
  maxChars?: number;
  /** Longest a single entry may be before it is clipped. One node returning a
   * huge blob must not be able to evict the entire history by itself. */
  maxEntryChars?: number;
};

const DEFAULTS = {
  keepVerbatim: 12,
  maxChars: 8000,
  maxEntryChars: 800,
} as const;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Accumulates node outcomes and renders them compacted.
 *
 * Kept as a class because the orchestrator threads one of these through a whole
 * run, appending as it goes — the alternative was a string it kept reassigning,
 * which is exactly the thing that grew unbounded.
 */
export class WorkContext {
  private readonly entries: WorkEntry[] = [];
  private readonly opts: Required<CompactOptions>;

  constructor(opts: CompactOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Record what a node produced. Empty text is ignored — a node with nothing
   * to say should not push a real step out of the verbatim window. */
  add(node: string, text: string): void {
    const clipped = clip(String(text ?? ""), this.opts.maxEntryChars);
    if (!clipped) return;
    this.entries.push({ node, text: clipped });
  }

  get length(): number {
    return this.entries.length;
  }

  /** The context as the model should see it. */
  render(): string {
    if (!this.entries.length) return "";

    const { keepVerbatim, maxChars } = this.opts;
    const recent = this.entries.slice(-keepVerbatim);
    const older = this.entries.slice(0, Math.max(0, this.entries.length - keepVerbatim));

    let out = older.length ? [summarize(older), ...recent.map(line)].join("\n") : recent.map(line).join("\n");
    if (out.length <= maxChars) return out;

    // Still too long: drop the oldest verbatim entries into the summary until it
    // fits. The newest are kept — a long run's next action depends on what just
    // happened, not on what happened an hour ago.
    let kept = [...recent];
    let rolled = [...older];
    while (out.length > maxChars && kept.length > 1) {
      rolled = [...rolled, kept[0]];
      kept = kept.slice(1);
      out = [summarize(rolled), ...kept.map(line)].join("\n");
    }
    // A single entry can still exceed the ceiling; clip rather than return
    // something the caller thinks is bounded when it is not.
    return out.length > maxChars ? `${out.slice(0, maxChars - 1)}…` : out;
  }

  toString(): string {
    return this.render();
  }
}

function line(e: WorkEntry): string {
  return `${e.node}: ${e.text}`;
}

/** Collapse older entries to their shape: how many, and which nodes ran. */
function summarize(entries: WorkEntry[]): string {
  const names = entries.map((e) => e.node);
  const unique: string[] = [];
  for (const n of names) if (unique[unique.length - 1] !== n) unique.push(n);
  const shown = unique.slice(0, 8);
  const more = unique.length - shown.length;
  const trail = more > 0 ? `, +${more} more` : "";
  return `[${entries.length} earlier step${entries.length === 1 ? "" : "s"}: ${shown.join(" → ")}${trail}]`;
}
