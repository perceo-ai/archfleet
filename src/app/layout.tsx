import type { Metadata } from "next";
import { AppNav } from "@/components/shell/AppNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Archfleet",
  description: "Open computer-use automation: describe a task, run it, keep the evidence.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="grid-lines relative min-h-screen flex flex-col bg-[#312F2F] text-white">
        <div className="dot-pattern dot-pattern-fade z-0" aria-hidden="true" />
        <AppNav />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
