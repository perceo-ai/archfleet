"use client";

// The app shell: a persistent left rail plus a topbar, wrapped around every page
// except /login and the automation workspace, which owns its whole viewport.

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  Activity,
  Bot,
  FileText,
  Inbox,
  Plus,
  Server,
  Settings,
  SunMedium,
  type LucideIcon,
} from "lucide-react";
import { usePolling } from "@/lib/ui/api";
import { CommandPalette, PaletteTrigger } from "@/components/shell/CommandPalette";
import { Logo } from "@/components/ui/Logo";
import type { Automation, HumanTakeover } from "@/lib/fleet/types";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Inbox", icon: Inbox },
  { href: "/automations", label: "Automations", icon: Bot },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/environments", label: "Environments", icon: Server },
];

/** Routes that render their own full-viewport layout. */
function isFocusRoute(pathname: string): boolean {
  return /^\/automations\/[^/]+$/.test(pathname);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const takeovers = usePolling<HumanTakeover[]>("/api/takeovers?status=open", 15000);
  const automations = usePolling<Automation[]>("/api/automations", 60000);

  if (pathname.startsWith("/login")) return <>{children}</>;
  if (isFocusRoute(pathname)) return <>{children}</>;

  const openTakeovers = (takeovers.data ?? []).length;
  const counts: Record<string, number> = {
    "/": openTakeovers,
    "/automations": (automations.data ?? []).length,
  };

  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const recent = [...(automations.data ?? [])]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-top">
          <Link href="/" className="hstack" style={{ gap: 9 }} aria-label="Archfleet home">
            <Logo />
            <span className="wordmark hide-collapsed">Archfleet</span>
          </Link>
        </div>

        <nav className="rail-nav" aria-label="Primary">
          <Link href="/automations/new" className="nav-item" style={{ color: "var(--accent-hi)" }}>
            <Plus className="ico" aria-hidden="true" />
            <span className="hide-collapsed">New automation</span>
          </Link>

          <div className="rail-group hide-collapsed">
            <span className="t-label">Workspace</span>
          </div>

          {NAV.map((item) => {
            const Icon = item.icon;
            const count = counts[item.href];
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active(item.href) ? "page" : undefined}
                className={clsx("nav-item", active(item.href) && "active")}
              >
                <Icon className="ico" aria-hidden="true" />
                <span className="hide-collapsed">{item.label}</span>
                {count ? (
                  <span
                    className={clsx("nav-count hide-collapsed", item.href === "/" && "alert")}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {recent.length > 0 ? (
            <>
              <div className="rail-group hide-collapsed">
                <span className="t-label">Recent</span>
              </div>
              {recent.map((a) => (
                <Link key={a.id} href={`/automations/${a.id}`} className="nav-item">
                  <FileText className="ico" aria-hidden="true" />
                  <span className="hide-collapsed truncate">{a.name}</span>
                </Link>
              ))}
            </>
          ) : null}
        </nav>

        <div className="rail-bottom">
          <Link href="/settings" className="nav-item">
            <Settings className="ico" aria-hidden="true" />
            <span className="hide-collapsed">Settings</span>
          </Link>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Breadcrumbs pathname={pathname} />
          <div className="topbar-right">
            <PaletteTrigger />
            <ThemeToggle />
          </div>
        </header>
        <div className="page">{children}</div>
      </div>

      <CommandPalette />
    </div>
  );
}

const CRUMB_LABELS: Record<string, string> = {
  "": "Inbox",
  automations: "Automations",
  activity: "Activity",
  environments: "Environments",
  runs: "Activity",
  users: "Settings",
  settings: "Settings",
};

function Breadcrumbs({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return <div className="crumbs"><span className="here">Inbox</span></div>;
  return (
    <div className="crumbs">
      {parts.map((part, i) => {
        const last = i === parts.length - 1;
        const href = "/" + parts.slice(0, i + 1).join("/");
        const label = CRUMB_LABELS[part] ?? part;
        return (
          <span key={href} className="hstack" style={{ gap: 7 }}>
            {i > 0 ? <span className="sep">/</span> : null}
            {last ? (
              <span className="here truncate">{label}</span>
            ) : (
              <Link href={href}>{label}</Link>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** The token layer supports light; the app ships dark, so this is a preference.
 * The document element is the source of truth (set before hydration by the
 * inline script in the root layout), so there is no state to sync. */
const themeListeners = new Set<() => void>();

function subscribeTheme(onChange: () => void) {
  themeListeners.add(onChange);
  return () => themeListeners.delete(onChange);
}

function ThemeToggle() {
  const light = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme === "light",
    () => false,
  );

  const toggle = useCallback(() => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("af-theme", next);
    } catch {
      // private mode — the preference just does not persist
    }
    themeListeners.forEach((fn) => fn());
  }, []);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      aria-pressed={light}
      onClick={toggle}
    >
      <SunMedium className="ico" aria-hidden="true" />
    </button>
  );
}
