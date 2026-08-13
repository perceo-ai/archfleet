"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/automations", label: "Automations" },
  { href: "/environments", label: "Environments" },
  { href: "/fleet", label: "Fleet" },
  { href: "/users", label: "Users" },
];

/** Top navigation shared by every page (hidden on /login). */
export function AppNav() {
  const pathname = usePathname() ?? "/";
  if (pathname.startsWith("/login")) return null;
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="relative z-20 border-b border-white/[0.08] bg-[#312f2f]/70 backdrop-blur-xl">
      <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-2 md:px-12">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-gradient-to-b from-[#8b5cf6] to-[#7848e6] text-[11px] font-semibold uppercase text-white shadow-sm">
            pe
          </span>
          <span className="font-serif text-lg font-bold italic tracking-tight text-white">
            Perceo Archfleet
          </span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={clsx(
                "rounded-[5px] px-3 py-1.5 font-medium transition",
                isActive(link.href)
                  ? "bg-white/[0.1] text-white"
                  : "text-white/60 hover:bg-white/[0.05] hover:text-white",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
