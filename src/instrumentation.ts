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
  const { makeTriggerExecute } = await import("@/lib/fleet/server-runtime");
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

  // Node timers keep the loop alive; unref so it never blocks shutdown.
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}
