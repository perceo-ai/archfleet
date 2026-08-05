// Resolve a request for a run artifact to a safe on-disk path, preventing path
// traversal outside the run's artifact directory.

import { basename, resolve, sep } from "node:path";

export function artifactBaseDir(): string {
  return process.env.CUF_ARTIFACT_DIR ?? `${process.cwd()}/data/artifacts`;
}

/** Safe absolute path for <baseDir>/<runId>/<name>, or null if it escapes. */
export function safeArtifactPath(baseDir: string, runId: string, name: string): string | null {
  const cleanRun = basename(runId);
  const cleanName = basename(name); // strips any ../ segments
  const root = resolve(baseDir, cleanRun);
  const full = resolve(root, cleanName);
  return full === root || full.startsWith(root + sep) ? full : null;
}

export function contentTypeFor(name: string): string {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".txt") || name.endsWith(".log")) return "text/plain";
  return "application/octet-stream";
}
