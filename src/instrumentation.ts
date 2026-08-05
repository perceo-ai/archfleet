// Next.js instrumentation: runs once when the server process starts. We use it to
// drive schedule triggers — every CUF_TICK_INTERVAL_MS the server fires any due
// cron triggers. Set CUF_DISABLE_TICK=1 to turn this off (e.g. when an external
// scheduler POSTs /api/triggers/tick instead).

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CUF_DISABLE_TICK === "1") return;

  const intervalMs = Number(process.env.CUF_TICK_INTERVAL_MS ?? "60000");

  // Import lazily so this file stays edge/runtime-safe.
  const { getDb } = await import("@/lib/fleet/db/db");
  const { ensureSeeded } = await import("@/lib/fleet/db/init-db");
  const { makeTriggerExecute, processPendingRuns } = await import("@/lib/fleet/server-runtime");
  const { runDueTriggers } = await import("@/lib/fleet/triggers/triggers-runtime");

  // Seed workflows on first boot so the dashboard + triggers have data.
  try {
    ensureSeeded(getDb());
  } catch {
    // non-fatal — routes still work, just no pre-seeded workflow
  }

  const tick = async () => {
    try {
      const db = getDb();
      await runDueTriggers(db, new Date().toISOString(), makeTriggerExecute(db));
    } catch {
      // never let a tick failure crash the server; next tick retries
    }
  };

  // Worker loop: drain queued runs. Guarded so a hung run can't overlap itself.
  const workerMs = Number(process.env.CUF_WORKER_INTERVAL_MS ?? "5000");
  let working = false;
  const work = async () => {
    if (working) return;
    working = true;
    try {
      await processPendingRuns(getDb());
    } catch {
      // swallow — next tick retries
    } finally {
      working = false;
    }
  };

  // Node timers keep the loop alive; unref so they never block shutdown.
  const t1 = setInterval(tick, intervalMs);
  const t2 = setInterval(work, workerMs);
  for (const t of [t1, t2]) if (typeof t.unref === "function") t.unref();
}
