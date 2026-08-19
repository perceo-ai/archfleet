"use client";

// The desktop frame. Every place the UI shows what the agent is looking at uses
// this — inbox thumbnails, the workspace live card, the run view — so a desktop
// always reads as a desktop, with the same tag and caption bar.

import type { ReactNode } from "react";
import clsx from "clsx";

export function Viewport({
  src,
  iframeSrc,
  alt,
  tag,
  bar,
  className,
  style,
}: {
  /** Screenshot URL. Falls back to the placeholder gradient when absent. */
  src?: string;
  /** Interactive desktop (Guacamole) — takes precedence over a screenshot. */
  iframeSrc?: string;
  alt?: string;
  tag?: ReactNode;
  bar?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={clsx("viewport", className)} style={style}>
      {iframeSrc ? (
        <iframe
          src={iframeSrc}
          title={alt ?? "Runner desktop"}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "#000" }}
        />
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt ?? "Desktop screenshot"}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <div className="fake-desktop" />
      )}
      {tag ? <div className="vp-tag">{tag}</div> : null}
      {bar ? <div className="vp-bar">{bar}</div> : null}
    </div>
  );
}
