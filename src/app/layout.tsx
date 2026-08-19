import type { Metadata } from "next";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Archfleet",
  description: "Open computer-use automation: describe a task, run it, keep the evidence.",
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
