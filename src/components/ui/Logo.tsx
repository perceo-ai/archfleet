import Image from "next/image";

/** The Perceo mark. One component so the rail, the login card and the empty
 * workspace cannot drift apart — and so the asset is referenced from exactly
 * one place if it is ever replaced. */
export function Logo({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/perceo-logo.png"
      alt=""
      width={size}
      height={size}
      priority
      className={className}
      style={{ borderRadius: 6, display: "block" }}
    />
  );
}

/** Mark plus wordmark, for the places that introduce the product. */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="hstack" style={{ gap: 9 }}>
      <Logo size={size} />
      <span className="wordmark">Archfleet</span>
    </span>
  );
}
