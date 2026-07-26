import type { Metadata } from "next";
import Link from "next/link";
import { ClockControl } from "@/components/ClockControl";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vasooli — Kirana Relationship Manager",
  description: "The agent that takes the order is the agent that collects the payment.",
};

const nav = [
  { href: "/shop", label: "Shop" },
  { href: "/inbox", label: "Inbox" },
  { href: "/call", label: "Call" },
  { href: "/ledger", label: "Ledger" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/evals", label: "Evals" },
  { href: "/db", label: "DB" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-bold text-khata">वसूली · Vasooli</Link>
            <div className="flex items-center gap-4">
              <nav className="flex gap-4 text-sm">
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} className="text-gray-600 hover:text-khata">{n.label}</Link>
                ))}
              </nav>
              <ClockControl />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
