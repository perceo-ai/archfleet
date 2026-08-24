import { describe, expect, it } from "vitest";
import { openDb } from "../db/db";
import { createDbLeaseStore, createMemoryLeaseStore, type LeaseStore } from "./lease-store";

const T0 = "2026-08-20T10:00:00.000Z";
const T1 = "2026-08-20T10:05:00.000Z";
const T2 = "2026-08-20T10:10:00.000Z";

/** Both stores must behave identically — the memory one is the default, the db
 * one is what makes exclusion hold across workers. */
const stores: [string, () => LeaseStore][] = [
  ["memory", createMemoryLeaseStore],
  ["sqlite", () => createDbLeaseStore(openDb(":memory:"))],
];

describe.each(stores)("lease store (%s)", (_name, make) => {
  it("grants a free domain and refuses a second claimant", () => {
    const store = make();
    expect(store.claim("dom-a", "run_1", T2, T0)).toBe(true);
    expect(store.claim("dom-a", "run_2", T2, T0)).toBe(false);
    expect(store.get("dom-a", T0)?.holder).toBe("run_1");
  });

  it("re-claiming your own live lease succeeds and extends it", () => {
    const store = make();
    store.claim("dom-a", "run_1", T1, T0);
    expect(store.claim("dom-a", "run_1", T2, T0)).toBe(true);
    expect(store.get("dom-a", T1)?.expiresAt).toBe(T2);
  });

  it("an expired lease is invisible and re-claimable by anyone", () => {
    const store = make();
    store.claim("dom-a", "run_1", T1, T0);
    expect(store.heldDomains(T1)).toEqual([]);
    expect(store.get("dom-a", T1)).toBeUndefined();
    // A controller killed mid-run must not remove the desktop from the fleet.
    expect(store.claim("dom-a", "run_2", T2, T1)).toBe(true);
    expect(store.get("dom-a", T1)?.holder).toBe("run_2");
  });

  it("only lists live leases", () => {
    const store = make();
    store.claim("dom-a", "run_1", T2, T0);
    store.claim("dom-b", "run_2", T1, T0);
    expect(store.heldDomains(T0).sort()).toEqual(["dom-a", "dom-b"]);
    expect(store.heldDomains(T1)).toEqual(["dom-a"]);
  });

  it("release only drops your own lease", () => {
    const store = make();
    store.claim("dom-a", "run_1", T2, T0);
    // A late release from a previous holder must not free someone else's desktop.
    store.release("dom-a", "run_stale");
    expect(store.get("dom-a", T0)?.holder).toBe("run_1");
    store.release("dom-a", "run_1");
    expect(store.get("dom-a", T0)).toBeUndefined();
  });

  it("release without a holder is an unconditional break-lease", () => {
    const store = make();
    store.claim("dom-a", "run_1", T2, T0);
    store.release("dom-a");
    expect(store.get("dom-a", T0)).toBeUndefined();
  });

  it("renew extends a live lease and fails once it is lost", () => {
    const store = make();
    store.claim("dom-a", "run_1", T1, T0);
    expect(store.renew("dom-a", "run_1", T2, T0)).toBe(true);
    expect(store.get("dom-a", T1)?.expiresAt).toBe(T2);
    expect(store.renew("dom-a", "run_2", T2, T0)).toBe(false);
    // Expired: the holder has to reopen, not silently resurrect its claim.
    expect(store.renew("dom-a", "run_1", T2, T2)).toBe(false);
  });

  it("sweepExpired frees only what has lapsed", () => {
    const store = make();
    store.claim("dom-a", "run_1", T1, T0);
    store.claim("dom-b", "run_2", T2, T0);
    expect(store.sweepExpired(T1)).toBe(1);
    expect(store.heldDomains(T1)).toEqual(["dom-b"]);
  });
});
