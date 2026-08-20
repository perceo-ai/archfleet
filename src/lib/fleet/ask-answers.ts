// Landing a human's answers in a run. Deliberately its own module: writing two
// values needs the db and the secret store, not the orchestrator, libvirt or
// ssh — an API route should not drag all of that in behind it.

import type { Db } from "./db/db";
import { saveSecret } from "./db/secrets-repo";
import { splitAnswers, type HumanAsk } from "./human-ask";

export type AskAnswerReport = {
  /** Param names written to the run. */
  params: string[];
  /** Secret answers stored encrypted. */
  secrets: string[];
  /** Secret answers that could NOT be stored (no encryption key configured).
   * The caller must not resume the run — it asked for these values. */
  dropped: string[];
};

/** Plain answers become run params (later nodes resolve `{{param.x}}`); answers
 * the ask marked secret become run-scoped secrets (`{{secret.x}}`, redacted
 * from every persisted log).
 *
 * Returns what actually landed. A secret that cannot be encrypted is reported as
 * dropped rather than written in the clear — and never silently, because the run
 * asked for it and would otherwise resume without it. */
export function applyAskAnswers(
  db: Db,
  runId: string,
  ask: HumanAsk,
  answers: Record<string, string>,
): AskAnswerReport {
  const { params, secrets } = splitAnswers(ask, answers);

  if (Object.keys(params).length > 0) {
    const row = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get(runId) as
      | { params_json: string }
      | undefined;
    const merged = { ...(JSON.parse(row?.params_json || "{}") as Record<string, unknown>), ...params };
    db.prepare("UPDATE cuf_runs SET params_json=? WHERE id=?").run(JSON.stringify(merged), runId);
  }

  const stored: string[] = [];
  const dropped: string[] = [];
  for (const [name, value] of Object.entries(secrets)) {
    try {
      saveSecret(db, { name, scope: "run", scopeId: runId, value });
      stored.push(name);
    } catch {
      dropped.push(name);
    }
  }
  return { params: Object.keys(params), secrets: stored, dropped };
}
