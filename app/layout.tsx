import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "FC Tournament",
    template: "%s | FC Tournament",
  },
  description: "An open-source soccer tournament manager.",
};

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/standings", label: "Standings" },
  { href: "/matches", label: "Matches" },
  { href: "/bracket", label: "Bracket" },
  // Do not prefetch the protected route: a background 401 can trigger the
  // browser's Basic Auth prompt before the visitor chooses Admin.
  { href: "/admin", label: "Admin", prefetch: false },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4">
            <Link href="/" className="text-lg font-bold tracking-tight">
              FC Tournament
            </Link>
            <nav aria-label="Main navigation">
              <ul className="flex flex-wrap gap-1">
                {navLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      prefetch={link.prefetch}
                      className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-slate-500">
            <p>FC Tournament &mdash; an open-source soccer tournament manager.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
