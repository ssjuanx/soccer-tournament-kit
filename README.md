# FC Tournament

An open-source soccer tournament manager. One administrator enters
participants, teams, and match scores manually. Everyone else visits a public,
read-only website to follow the group stage and knockout bracket.

## Status

The app supports tournament setup, balanced round-robin groups, score entry,
standings, and independent Championship and Consolation brackets. Data is
persisted in Neon Postgres and the public pages are read-only.

## Planned features

- **Group stage** &mdash; teams drawn into groups, round-robin matches, and
  automatically computed standings with points and tiebreakers.
- **Knockout bracket** &mdash; a single-elimination bracket built from the
  qualified teams, from the round of 16 through the final.
- **Public site** &mdash; read-only views for standings, matches, and the
  bracket.
- **Admin area** &mdash; a single administrator manages participants, teams,
  and match scores.

## Tech stack

- [Next.js](https://nextjs.org) with the App Router
- [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS](https://tailwindcss.com)
- Minimal dependencies by design

## Getting started

Requires Node.js 20.9 or newer (developed with Node 24).

Create `.env.local` with:

```env
DATABASE_URL=your_pooled_neon_connection_string
DATABASE_URL_UNPOOLED=your_direct_neon_connection_string
ADMIN_PASSWORD=choose_a_private_admin_password
```

`ADMIN_PASSWORD` protects `/admin` with HTTP Basic authentication in
production. Production returns an error instead of exposing the admin when the
variable is missing.

```bash
# Install dependencies
npm install

# Start the development server (http://localhost:3000)
npm run dev

# Create a production build
npm run build

# Start the production server
npm start
```

## Project structure

```
.
├── app/                # App Router routes
│   ├── layout.tsx      # Root layout: header, navigation, footer
│   ├── globals.css     # Tailwind CSS entry point
│   ├── page.tsx        # Landing page
│   ├── standings/      # Group-stage standings (placeholder)
│   ├── matches/        # Match list and scores (placeholder)
│   ├── bracket/        # Knockout bracket (placeholder)
│   └── admin/          # Administrator area (placeholder)
├── next.config.ts      # Next.js configuration
├── postcss.config.mjs  # PostCSS configuration (Tailwind)
├── tsconfig.json       # TypeScript configuration
└── package.json
```

## Design principles

- Keep the implementation small and easy to extend.
- Mobile-first, responsive layouts.
- All code, UI labels, and documentation are in English.
- Avoid premature abstractions; add structure as real requirements emerge.

## License

This project is licensed under the [MIT License](./LICENSE).
