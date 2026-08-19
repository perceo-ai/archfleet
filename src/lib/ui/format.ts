// Small display formatters shared by the client pages.

export function timeAgo(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const s = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function duration(startIso: string, endIso?: string, now: Date = new Date()): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const s = Math.max(0, Math.round((end - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/** "semantic_test" -> "Semantic test" */
export function categoryLabel(category: string): string {
  const text = category.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Guided schedule choices — users pick a cadence, not a cron string. */
export const SCHEDULE_PRESETS: { key: string; label: string; cron: string }[] = [
  { key: "15min", label: "Every 15 minutes", cron: "*/15 * * * *" },
  { key: "hourly", label: "Every hour", cron: "0 * * * *" },
  { key: "daily", label: "Every day at 9:00", cron: "0 9 * * *" },
  { key: "weekdays", label: "Weekdays at 9:00", cron: "0 9 * * 1-5" },
  { key: "weekly", label: "Mondays at 9:00", cron: "0 9 * * 1" },
  { key: "monthly", label: "1st of the month at 9:00", cron: "0 9 1 * *" },
];

/** Human-readable cadence for a stored cron, falling back to the raw string. */
export function cadenceLabel(cron: string | undefined): string {
  if (!cron) return "";
  return SCHEDULE_PRESETS.find((p) => p.cron === cron)?.label ?? cron;
}
