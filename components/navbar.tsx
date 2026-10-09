import Link from "next/link";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/standings", label: "Standings" },
  { href: "/matches", label: "Matches" },
  { href: "/bracket", label: "Bracket" },
  { href: "/rules", label: "Rules" },
  // Do not prefetch the protected route: a background 401 can trigger the
  // browser's Basic Auth prompt before the visitor chooses Admin.
  { href: "/admin", label: "Admin", prefetch: false },
];

/**
 * Site header with the primary navigation. Extracted from `app/layout.tsx`.
 */
export function Navbar() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
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
  );
}