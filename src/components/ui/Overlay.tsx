"use client";

// Drawers and modals: the two ways to show a detour without leaving the page.
// Both share the scrim, Escape-to-close, and focus containment.

import { useEffect, type ReactNode } from "react";
import clsx from "clsx";
import { X } from "lucide-react";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

function Scrim({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div
      className={clsx("scrim", open && "open")}
      onClick={onClose}
      aria-hidden="true"
    />
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  actions,
  width,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  width?: string;
  children: ReactNode;
}) {
  useEscape(open, onClose);
  return (
    <>
      <Scrim open={open} onClose={onClose} />
      <aside
        className={clsx("drawer", open && "open")}
        style={width ? { width } : undefined}
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        // Kept mounted for the slide transition, but nothing inside should be
        // tabbable (or read out) while it is off-screen.
        inert={!open}
      >
        <div className="drawer-head">
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X className="ico" aria-hidden="true" />
          </button>
          <div className="grow">
            <div className="strong truncate">{title}</div>
            {subtitle ? <div className="t-xs faint">{subtitle}</div> : null}
          </div>
          {actions}
        </div>
        <div className="drawer-body">{open ? children : null}</div>
      </aside>
    </>
  );
}

export function Modal({
  open,
  onClose,
  icon,
  title,
  subtitle,
  wide,
  footer,
  headRight,
  children,
}: {
  open: boolean;
  onClose: () => void;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
  headRight?: ReactNode;
  children: ReactNode;
}) {
  useEscape(open, onClose);
  return (
    <>
      <Scrim open={open} onClose={onClose} />
      <div
        className={clsx("modal", wide && "wide", open && "open")}
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="modal-head">
          {icon}
          <div className="grow">
            <div className="strong">{title}</div>
            {subtitle ? <div className="t-xs faint">{subtitle}</div> : null}
          </div>
          {headRight}
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X className="ico" aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">{open ? children : null}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </>
  );
}
