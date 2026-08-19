import type { Metadata } from "next";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

const DESCRIPTION =
  "Open computer-use automation: describe a task, run it, keep the evidence.";

export const metadata: Metadata = {
  title: { default: "Archfleet", template: "%s · Archfleet" },
  description: DESCRIPTION,
  applicationName: "Archfleet",
  // src/app/icon.png and apple-icon.png are the same Perceo mark, picked up by
  // Next's file conventions; naming them here covers the older link rels too.
  icons: {
    icon: "/icon.png",
    shortcut: "/perceo-logo.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "Archfleet",
    description: DESCRIPTION,
    siteName: "Archfleet",
    images: [{ url: "/perceo-logo.png", width: 250, height: 250, alt: "Archfleet" }],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Archfleet",
    description: DESCRIPTION,
    images: ["/perceo-logo.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" className="antialiased">
      <body>
        {/* Apply the saved theme before paint so light mode does not flash dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.theme=localStorage.getItem('af-theme')==='light'?'light':'dark'}catch(e){}",
          }}
        />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
