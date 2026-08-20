"use client";

// ⌘K: jump to any automation, run or environment without leaving the page.
// Opening it is the reason the nav can stay this short.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Search } from "lucide-react";
import { getJson } from "@/lib/ui/api";
import type { Automation, PreparedEnvironment } from "@/lib/fleet/types";
import type { RunSummary } from "@/lib/fleet/db/runs-repo";

type Entry = { id: string; label: string; where: string; href: string };

let openPalette: (() => void) | undefined;

export function PaletteTrigger() {
  return (
    <button type="button" className="searchbtn" onClick={() => openPalette?.()}>
      <Search className="ico" aria-hidden="true" />
      Search or jump to…
      <span className="kbd">⌘K</span>
    </button>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);


  const load = useCallback(async () => {
    const [automations, runs, environments] = await Promise.all([
      getJson<Automation[]>("/api/automations").catch(() => []),
      getJson<RunSummary[]>("/api/runs").catch(() => []),
      getJson<PreparedEnvironment[]>("/api/environments").catch(() => []),
    ]);
    setEntries([
      { id: "new", label: "New automation…", where: "Create", href: "/automations/new" },
      ...automations.map((a) => ({
        id: `a-${a.id}`,
        label: a.name,
        where: "Automation",
        href: `/automations/${a.id}`,
      })),
      ...runs.slice(0, 20).map((r) => ({
        id: `r-${r.id}`,
        label: `${r.workflowName} — ${r.status}`,
        where: "Run",
        href: `/runs/${r.id}`,
      })),
      ...environments.map((e) => ({
        id: `e-${e.id}`,
        label: e.name,
        where: "Environment",
        href: "/environments",
      })),
    ]);
  }, []);

  // Loading is kicked off by whatever opens the palette, not by an effect
  // reacting to `open` — that would cascade a render on every toggle.
  const show = useCallback(() => {
    setOpen(true);
    setQuery("");
    setSel(0);
    void load();
  }, [load]);

  useEffect(() => {
    openPalette = show;
    return () => {
      openPalette = undefined;
    };
  }, [show]);

  const results = useMemo(
    () => entries.filter((e) => e.label.toLowerCase().includes(query.toLowerCase())).slice(0, 40),
    [entries, query],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else show();
        return;
      }
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => (results.length ? (s + 1) % results.length : 0));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => (results.length ? (s - 1 + results.length) % results.length : 0));
      }
      if (e.key === "Enter" && results[sel]) {
        e.preventDefault();
        setOpen(false);
        router.push(results[sel].href);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, results, sel, router, show]);

  return (
    <>
      <div className={clsx("scrim", open && "open")} onClick={() => setOpen(false)} aria-hidden="true" />
      <div
        className={clsx("palette", open && "open")}
        role="dialog"
        aria-label="Command palette"
        aria-hidden={!open}
        inert={!open}
      >
        <input
          value={query}
          autoFocus={open}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          placeholder="Search automations, runs, environments…"
          aria-label="Search"
        />
        <div className="results">
          {results.length === 0 ? (
            <div className="empty">No matches</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                type="button"
                className="pres"
                data-sel={i === sel ? "1" : "0"}
                onMouseEnter={() => setSel(i)}
                onClick={() => {
                  setOpen(false);
                  router.push(r.href);
                }}
              >
                <span className="truncate">{r.label}</span>
                <span className="where">{r.where}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
