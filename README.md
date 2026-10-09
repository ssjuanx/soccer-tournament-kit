# ⚽ Soccer Tournament Kit

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

An open-source soccer tournament manager. One administrator enters
participants, teams, and match scores manually. Everyone else visits a public,
read-only website to follow the group stage and knockout bracket.

Designed for friendly, in-person tournaments (amateur leagues, office cups,
weekend pichadas) where a single person is in charge of keeping scores and the
rest of the participants just want to check tables, fixtures, and brackets from
their phones.

## Features

- **Tournament setup** &mdash; name, dates, format, and number of groups are
  configured by the admin in a single form.
- **Group stage** &mdash; teams are drawn into balanced round-robin groups.
  Standings (points, goal difference, goals for) and tiebreakers are computed
  automatically, including cross-group comparison and a manual override for the
  final ranking.
- **Knockout bracket** &mdash; a single-elimination bracket built from the
  qualified teams, from the round of 16 through the final. Includes an
  independent **Consolation bracket** alongside the **Championship bracket**.
- **Public site** &mdash; read-only views for standings, the numbered match
  order with scores, both brackets, and the tournament rules.
- **Admin area** &mdash; a single administrator manages metadata, the draw,
  fixtures and scores, advancement, manual tiebreaks, and editable public rule
  cards. The area is protected by HTTP Basic auth.
- **Persistence** &mdash; all data lives in Neon Postgres; the public pages are
  server-rendered and read-only.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS](https://tailwindcss.com) for styling
- [Drizzle ORM](https://orm.drizzle.team) + [Neon Postgres](https://neon.tech)
  (serverless driver)
- Minimal dependencies by design

## Getting started

Requires Node.js 20.9 or newer (developed with Node 24).

1. **Configure environment variables.** Copy the example file and fill in your
   Neon connection strings and an admin password:

   ```bash
   cp .env.example .env.local
   ```

   ```env
   DATABASE_URL=your_pooled_neon_connection_string
   DATABASE_URL_UNPOOLED=your_direct_neon_connection_string
   ADMIN_PASSWORD=choose_a_private_admin_password
   ```

   `DATABASE_URL` should use the pooled (PgBouncer) endpoint for app queries,
   and `DATABASE_URL_UNPOOLED` the direct endpoint for migrations. See the
   [Neon docs](https://neon.tech/docs/connect/connection-pooling) for details.

   `ADMIN_PASSWORD` protects `/admin` with HTTP Basic authentication in
   production. Production returns an error instead of exposing the admin when
   the variable is missing.

2. **Install, migrate, and run:**

   ```bash
   # Install dependencies
   npm install

   # Apply the database schema (uses DATABASE_URL_UNPOOLED)
   npm run db:migrate

   # Start the development server (http://localhost:3000)
   npm run dev

   # Create a production build and start it
   npm run build
   npm start
   ```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm start` | Start the production server |
| `npm test` | Run the unit tests (Node's built-in test runner) |
| `npm run db:migrate` | Apply Drizzle migrations to the database |
| `npm run db:generate` | Generate a new Drizzle migration from schema changes |

## Project structure

```
.
├── app/                      # App Router routes
│   ├── layout.tsx            # Root layout: header, navigation, footer
│   ├── globals.css           # Tailwind CSS entry point
│   ├── page.tsx              # Landing page
│   ├── standings/            # Group-stage standings
│   ├── matches/              # Numbered match order and scores
│   ├── bracket/              # Championship and Consolation brackets
│   ├── rules/                # Public tournament rules
│   └── admin/                # Administrator area (protected)
│       ├── sections/         # Setup form split into focused sections
│       └── ...
├── components/               # Shared UI components (navbar, tabs, cards, ...)
├── lib/
│   ├── tournament/           # Pure tournament logic (draw, fixtures, groups,
│   │                         #   standings, tiebreakers, knockout, cross-group)
│   └── db/                   # Drizzle schema, client, queries, migrations
├── proxy.ts                  # Basic-auth middleware protecting /admin
├── drizzle.config.ts         # Drizzle Kit configuration
├── next.config.ts            # Next.js configuration
├── tsconfig.json             # TypeScript configuration
└── package.json
```

The tournament rules engine in `lib/tournament/` is pure TypeScript with no I/O,
which keeps it easy to unit-test (see the `*.test.ts` files there) and to reuse.

## Design principles

- Keep the implementation small and easy to extend.
- Mobile-first, responsive layouts.
- All code, UI labels, and documentation are in English.
- Avoid premature abstractions; add structure as real requirements emerge.

## Contributing

Issues and pull requests are welcome. Please open an issue first to discuss
significant changes. Run `npm test` before submitting.

## License

This project is licensed under the [MIT License](./LICENSE).
