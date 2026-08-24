// Who currently holds a desktop. The daemon used to keep this in a per-instance
// Map, but `buildRunDeps` builds a fresh daemon for every run, so nothing stopped
// two runs from reverting and driving the same domain — and a session that holds a
// desktop across many HTTP requests would have exposed it immediately.
//
// A lease is (domain -> holder) with an expiry. The expiry is the important part:
// the controller can be killed mid-run, and without one a single SIGKILL would
// remove a desktop from the fleet permanently.

import type { Db } from "../db/db";

export type Lease = {
  domain: string;
  holder: string;
  acquiredAt: string;
  expiresAt: string;
};

export type LeaseStore = {
  /** Take `domain` for `holder` until `expiresAt`. False if someone else holds a
   * live lease on it. Re-claiming your own lease succeeds (idempotent retry). */
  claim(domain: string, holder: string, expiresAt: string, now?: string): boolean;
  /** Give the domain back. With a holder, only that holder's lease is dropped, so
   * a late release cannot free a desktop somebody else has since taken. */
  release(domain: string, holder?: string): void;
  /** Domains with a live (unexpired) lease. */
  heldDomains(now?: string): string[];
  /** Push a live lease's expiry out. False if the lease was already lost. */
  renew(domain: string, holder: string, expiresAt: string, now?: string): boolean;
  get(domain: string, now?: string): Lease | undefined;
  /** Drop expired rows. Returns how many were freed. */
  sweepExpired(now?: string): number;
};

const iso = () => new Date().toISOString();

/** Process-local leases. The default, and what the unit tests use — behaviour is
 * identical to the Map the daemon used to hold, plus expiry. */
export function createMemoryLeaseStore(): LeaseStore {
  const leases = new Map<string, Lease>();
  const live = (domain: string, now: string) => {
    const lease = leases.get(domain);
    if (!lease) return undefined;
    if (lease.expiresAt <= now) {
      leases.delete(domain);
      return undefined;
    }
    return lease;
  };
  return {
    claim(domain, holder, expiresAt, now = iso()) {
      const current = live(domain, now);
      if (current && current.holder !== holder) return false;
      leases.set(domain, {
        domain,
        holder,
        acquiredAt: current?.acquiredAt ?? now,
        expiresAt,
      });
      return true;
    },
    release(domain, holder) {
      const current = leases.get(domain);
      if (!current) return;
      if (holder && current.holder !== holder) return;
      leases.delete(domain);
    },
    heldDomains(now = iso()) {
      return [...leases.keys()].filter((domain) => live(domain, now));
    },
    renew(domain, holder, expiresAt, now = iso()) {
      const current = live(domain, now);
      if (!current || current.holder !== holder) return false;
      leases.set(domain, { ...current, expiresAt });
      return true;
    },
    get(domain, now = iso()) {
      return live(domain, now);
    },
    sweepExpired(now = iso()) {
      let freed = 0;
      for (const [domain, lease] of [...leases]) {
        if (lease.expiresAt <= now) {
          leases.delete(domain);
          freed++;
        }
      }
      return freed;
    },
  };
}

/** Leases in SQLite, so exclusion holds across worker instances and survives a
 * restart. `claim` is one conditional upsert — the same atomicity trick
 * `claimQueuedRun` already relies on, so two claimants cannot both win. */
export function createDbLeaseStore(db: Db): LeaseStore {
  return {
    claim(domain, holder, expiresAt, now = iso()) {
      const res = db
        .prepare(
          `INSERT INTO cuf_vm_leases (domain, holder, acquired_at, expires_at)
             VALUES (?,?,?,?)
           ON CONFLICT(domain) DO UPDATE SET
             holder=excluded.holder,
             acquired_at=CASE WHEN cuf_vm_leases.holder=excluded.holder
                              THEN cuf_vm_leases.acquired_at ELSE excluded.acquired_at END,
             expires_at=excluded.expires_at
           WHERE cuf_vm_leases.expires_at <= ? OR cuf_vm_leases.holder = excluded.holder`,
        )
        .run(domain, holder, now, expiresAt, now);
      return res.changes === 1;
    },
    release(domain, holder) {
      if (holder) {
        db.prepare("DELETE FROM cuf_vm_leases WHERE domain=? AND holder=?").run(domain, holder);
      } else {
        db.prepare("DELETE FROM cuf_vm_leases WHERE domain=?").run(domain);
      }
    },
    heldDomains(now = iso()) {
      const rows = db
        .prepare("SELECT domain FROM cuf_vm_leases WHERE expires_at > ?")
        .all(now) as { domain: string }[];
      return rows.map((r) => r.domain);
    },
    renew(domain, holder, expiresAt, now = iso()) {
      const res = db
        .prepare(
          "UPDATE cuf_vm_leases SET expires_at=? WHERE domain=? AND holder=? AND expires_at > ?",
        )
        .run(expiresAt, domain, holder, now);
      return res.changes === 1;
    },
    get(domain, now = iso()) {
      const row = db
        .prepare("SELECT * FROM cuf_vm_leases WHERE domain=? AND expires_at > ?")
        .get(domain, now) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        domain: row.domain as string,
        holder: row.holder as string,
        acquiredAt: row.acquired_at as string,
        expiresAt: row.expires_at as string,
      };
    },
    sweepExpired(now = iso()) {
      return db.prepare("DELETE FROM cuf_vm_leases WHERE expires_at <= ?").run(now).changes as number;
    },
  };
}
