import { describe, expect, it } from "vitest";
import { WorkContext } from "./work-context";

describe("WorkContext", () => {
  it("renders nothing when nothing has happened", () => {
    expect(new WorkContext().render()).toBe("");
  });

  it("keeps a short run entirely verbatim", () => {
    const c = new WorkContext();
    c.add("Open portal", "loaded");
    c.add("Sign in", "signed in as ops@acme.com");
    expect(c.render()).toBe("Open portal: loaded\nSign in: signed in as ops@acme.com");
  });

  it("ignores a node that produced nothing", () => {
    // An empty result must not push a real step out of the verbatim window.
    const c = new WorkContext();
    c.add("Noop", "");
    c.add("Noop2", "   ");
    expect(c.length).toBe(0);
    expect(c.render()).toBe("");
  });

  it("collapses older steps but keeps the recent ones word for word", () => {
    const c = new WorkContext({ keepVerbatim: 3 });
    for (let i = 1; i <= 10; i++) c.add(`Step ${i}`, `did thing ${i}`);
    const out = c.render();

    expect(out).toContain("[7 earlier steps:");
    expect(out).toContain("Step 8: did thing 8");
    expect(out).toContain("Step 10: did thing 10");
    // The detail of long-past steps is gone; their shape remains.
    expect(out).not.toContain("did thing 1\n");
  });

  it("stays under the ceiling across a very long run", () => {
    // The case this exists for: an automation running for hours. As a plain
    // accumulating string this was ~600KB and would be rejected by the model.
    const c = new WorkContext({ maxChars: 2000 });
    for (let i = 0; i < 2000; i++) c.add(`Node ${i}`, "x".repeat(300));
    const out = c.render();
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(c.length).toBe(2000);
    // The newest step survives — it is what the next decision depends on.
    expect(out).toContain("Node 1999");
  });

  it("clips one enormous entry instead of letting it evict the history", () => {
    const c = new WorkContext({ keepVerbatim: 3, maxEntryChars: 100 });
    c.add("Small", "fine");
    c.add("Huge", "y".repeat(50_000));
    const out = c.render();
    expect(out).toContain("Small: fine");
    expect(out.length).toBeLessThan(1000);
    expect(out).toContain("…");
  });

  it("normalises whitespace so a multi-line blob stays one line", () => {
    const c = new WorkContext();
    c.add("Report", "line one\n\n   line two\t\tline three");
    expect(c.render()).toBe("Report: line one line two line three");
  });

  it("summarises repeated node names once, not once per visit", () => {
    // A retry loop hitting the same node 40 times should read as one name.
    const c = new WorkContext({ keepVerbatim: 1 });
    for (let i = 0; i < 40; i++) c.add("Retry", `attempt ${i}`);
    const out = c.render();
    expect(out).toContain("[39 earlier steps: Retry]");
  });

  it("caps how many distinct node names the summary lists", () => {
    const c = new WorkContext({ keepVerbatim: 1 });
    for (let i = 0; i < 30; i++) c.add(`N${i}`, "x");
    expect(c.render()).toMatch(/\+\d+ more/);
  });

  it("is usable directly in a template", () => {
    const c = new WorkContext();
    c.add("A", "done");
    expect(`${c}`).toBe("A: done");
  });
});
