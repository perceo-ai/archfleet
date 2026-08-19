"use client";

// Shared presentational primitives. One vocabulary for status, one for metadata,
// one for surfaces — so every page reads the same way.

import clsx from "clsx";
import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "danger" | "info" | "human" | "idle" | "accent";

/** Status pill. A pill always means "this is a status" — never a section label. */
export function Pill({
  tone = "idle",
  live,
  children,
  className,
}: {
  tone?: Tone;
  live?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={clsx("pill", tone, live && "live", className)}>
      <span className="dot" />
      {children}
    </span>
  );
}

/** Neutral metadata chip (category, target, environment) — quieter than a status. */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("chip", className)}>{children}</span>;
}

export function Card({
  children,
  className,
  as,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
} & React.HTMLAttributes<HTMLElement>) {
  const Tag = as ?? "section";
  return (
    <Tag className={clsx("card", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHead({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="card-head">
      <div className="grow">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

/** Section heading: a coloured dot plus a real heading, so pills stay statuses. */
export function SectionHead({
  tone,
  title,
  note,
  right,
}: {
  tone: string;
  title: string;
  note?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="hstack" style={{ marginBottom: 9 }}>
      <span className="sec-dot" style={{ background: tone }} />
      <h2 className="t-head">{title}</h2>
      {note ? <span className="t-sm dimmer">{note}</span> : null}
      {right ? (
        <>
          <div className="spacer" />
          {right}
        </>
      ) : null}
    </div>
  );
}

export function Meter({ value, tone }: { value: number; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className="meter">
      <i className={tone} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Stat({
  value,
  label,
  children,
}: {
  value: ReactNode;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="v">{value}</div>
      <div className="k">{label}</div>
      {children}
    </div>
  );
}

/** Last-N-runs strip: history at a glance instead of a single status word. */
export function RunStrip({ results, height = 15 }: { results: boolean[]; height?: number }) {
  if (results.length === 0) return <span className="faint t-xs">no runs</span>;
  return (
    <span className="hstack" style={{ gap: 3 }}>
      {results.map((ok, i) => (
        <i
          key={i}
          style={{
            width: 6,
            height,
            borderRadius: 2,
            opacity: 0.85,
            background: ok ? "var(--ok-base)" : "var(--danger-base)",
          }}
        />
      ))}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Table rows that open something must be reachable without a mouse. */
export function rowLinkProps(open: () => void) {
  return {
    tabIndex: 0,
    role: "link" as const,
    onClick: open,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    },
  };
}

/** Polling failed but stale data is still on screen — say so quietly rather
 * than pretending the numbers are live. */
export function StaleNotice({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <p className="t-xs hstack" style={{ color: "var(--warn)", gap: 8, margin: "0 0 10px" }} role="status">
      Showing the last data that loaded — refreshing failed.
      {onRetry ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </p>
  );
}

/** Trend line for a stat tile. Flat when there is nothing to show yet. */
export function Sparkline({
  values,
  tone = "var(--accent)",
}: {
  values: number[];
  tone?: string;
}) {
  if (values.length < 2) return null;
  const w = 100;
  const h = 22;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 2 - ((v - min) / (max - min || 1)) * (h - 5);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={tone}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: T; label: ReactNode }[];
  value: T;
  onChange: (key: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (key: T) => void;
  label?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          className="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.label}
          {o.count != null ? <span className="pip">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Banner({
  tone,
  icon,
  title,
  children,
  right,
}: {
  tone?: "human" | "danger" | "ok" | "warn";
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className={clsx("banner", tone)}>
      {icon ? <div className="b-ico">{icon}</div> : null}
      <div className="grow">
        <h3>{title}</h3>
        {children ? <div className="t-sm dim">{children}</div> : null}
      </div>
      {right}
    </div>
  );
}
