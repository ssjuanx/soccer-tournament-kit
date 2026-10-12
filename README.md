# ⚽ Soccer Tournament Kit

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

An open-source soccer tournament manager. One administrator enters participants, teams, and match scores manually. Everyone else visits a public, read-only website to follow the group stage and knockout bracket.

Designed for friendly, in-person tournaments where a single person is in charge of keeping scores and the rest of the participants just want to check tables, fixtures, and brackets from their phones.

## Features

- **Tournament setup** — name, dates, format, and number of groups are configured by the admin in a single form.
- **Group stage** — teams are drawn into balanced round-robin groups. Standings (points, goal difference, goals for) and tiebreakers are computed automatically, including cross-group comparison and a manual override for the final ranking.
- **Knockout bracket** — a single-elimination bracket built from the qualified teams, from the round of 16 through the final. Includes an independent **Consolation bracket** alongside the **Championship bracket**.
- **Public site** — read-only views for standings, the numbered match order with scores, both brackets, and the tournament rules.
- **Admin area** — a single administrator manages metadata, the draw, fixtures and scores, advancement, manual tiebreaks, and editable public rule cards. The area is protected by HTTP Basic auth.
- **Persistence** — all data lives in a Postgres database; the public pages are server-rendered and read-only.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS](https://tailwindcss.com) for styling
- [Drizzle ORM](https://orm.drizzle.team) for database access (serverless HTTP driver)
- Minimal dependencies by design

The project is developed and tested against [Neon Postgres](https://neon.tech) and deployed on [Vercel](https://vercel.com), but neither is mandatory. The app talks to Postgres over Drizzle's HTTP driver, so any Postgres provider works; and any host that runs Next.js (Vercel, Netlify, a Node server, a container) works too. See [Deployment](#deployment).

## Getting started

Requires Node.js 20.9 or newer (developed with Node 24).

### 1. Configure environment variables

Copy the example file and fill in your Postgres connection strings and an admin password:

```bash
cp .env.example .env.local
```

```env
# Postgres connection strings (from your database provider dashboard).
# DATABASE_URL uses the pooled (PgBouncer) endpoint for app queries.
# DATABASE_URL_UNPOOLED uses the direct endpoint for migrations / DDL.
DATABASE_URL=your_pooled_connection_string
DATABASE_URL_UNPOOLED=your_direct_connection_string

# Protects /admin with HTTP Basic auth (username: admin).
# In production the admin area returns an error if this is missing.
ADMIN_PASSWORD=choose_a_private_admin_password
```

`DATABASE_URL` should use the pooled endpoint for app queries, and `DATABASE_URL_UNPOOLED` the direct endpoint for migrations. If your provider does not offer a pooled endpoint, the same direct string can be used for both. See the [Neon docs](https://neon.tech/docs/connect/connection-pooling) for an example.

`ADMIN_PASSWORD` protects `/admin` with HTTP Basic authentication in production. Production returns an error instead of exposing the admin when the variable is missing. In development, `/admin` is open when `ADMIN_PASSWORD` is unset so you can iterate locally.

### 2. Install, migrate, and run

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

## Database schema

The schema is defined in `lib/db/schema.ts` (Drizzle) and its canonical SQL form lives in `lib/db/migrations/*.sql`. Apply it with `npm run db:migrate`. The database stores only the tournament's *stored facts* (configuration, identity, draw order, assignments, fixtures, scores); all derived values — standings, qualification, bracket advancement — are recomputed from those facts by the pure engine in `lib/tournament/` and never persisted.

Seven tables, all scoped to a `tournaments` row (child rows cascade-delete):

**`tournaments`** — one row per tournament.
`id`, `name`, `edition`, `date`, `description`, `participant_count`, `group_count`, `status` (`draft` | `check_in` | `group_stage` | `knockout_stage` | `completed`), `win_points` (default 3), `draw_points` (default 1), `loss_points` (default 0), `tiebreaker_order` (JSON text), `qualifiers_per_group` (legacy, default 2), `advancement` (JSON text — ordered list of `{ name, fromPosition, toPosition }` knockout destinations).

**`groups`** — round-robin groups.
`id`, `tournament_id` → `tournaments.id` (cascade), `label`.

**`teams`** — the soccer teams participants are assigned to.
`id`, `tournament_id` → `tournaments.id` (cascade), `name`.

**`participants`** — the people playing.
`id`, `tournament_id` → `tournaments.id` (cascade), `name`, `draw_order`, `assigned_team_id` → `teams.id` (set null), `group_id` → `groups.id` (set null).

**`matches`** — group and knockout fixtures.
`id`, `tournament_id` → `tournaments.id` (cascade), `stage` (`group` | `knockout`), `bracket_kind` (free-form slug, nullable), `group_id` → `groups.id` (set null), `knockout_round` (`round_of_64` | `round_of_32` | `round_of_16` | `quarter_final` | `semi_final` | `final`, nullable), `home_participant_id` → `participants.id` (set null), `away_participant_id` → `participants.id` (set null), `home_score`, `away_score`, `knockout_seed`.

**`manual_tiebreak_resolutions`** — the admin's explicit ordering of a tied cohort (used by the `manual` tiebreaker).
`id`, `tournament_id` → `tournaments.id` (cascade), `group_id` → `groups.id` (cascade), `participant_order` (JSON text), `cohort_key`. Unique on `(tournament_id, group_id, cohort_key)`.

**`tournament_rules`** — global, editable public rule cards (not tournament-scoped).
`id`, `title`, `body`, `sort_order`.

Identifiers are `text` to match the string IDs used throughout the domain model. Enums are stored as `text` with TypeScript-level union types (not native Postgres enums) to avoid a migration every time a value is added.

## Deployment

The app is a standard Next.js project, so it deploys anywhere Next.js runs. The reference setup uses **Vercel** + **Neon Postgres**, but you can swap either.

### With Vercel + Neon (reference)

1. **Create a Postgres database.** On [Neon](https://neon.tech) create a project and copy both connection strings: the pooled (`-pooler`) endpoint and the direct endpoint.
2. **Push the repository** to GitHub (or your Git provider) and import it into Vercel.
3. **Set environment variables** in the Vercel project settings:
   - `DATABASE_URL` — pooled connection string
   - `DATABASE_URL_UNPOOLED` — direct connection string
   - `ADMIN_PASSWORD` — your private admin password
4. **Apply the schema.** Run migrations against the direct endpoint once, e.g. locally with `.env.local` set:
   ```bash
   npm run db:migrate
   ```
   (Migrations use `DATABASE_URL_UNPOOLED`; DDL must run over the direct endpoint.)
5. **Deploy.** Vercel builds with `npm run build` and serves the app. Subsequent pushes to your default branch redeploy automatically.

### Swap the database

The app uses Drizzle's `neon-http` driver against a standard Postgres connection string. To use another Postgres provider (Supabase, Railway, a self-hosted instance, etc.), set `DATABASE_URL`/`DATABASE_URL_UNPOOLED` to that provider's pooled/direct strings. If your provider exposes a single endpoint, use it for both. No code changes are required as long as it speaks Postgres.

### Swap the host

Any environment that runs Next.js works — Netlify, Cloudflare, a Node server (`npm start`), or a Docker container. Provide the same three environment variables and run `npm run build` + `npm start` (or your host's equivalent).

## Admin access

`/admin` is protected by HTTP Basic auth implemented in `proxy.ts`. The single credential is username `admin` with the password from `ADMIN_PASSWORD`.

- **Production:** if `ADMIN_PASSWORD` is missing, `/admin` returns a `503` error instead of exposing the panel.
- **Development:** if `ADMIN_PASSWORD` is missing, `/admin` is open so you can work locally without configuring it.

Browsers cache Basic-auth credentials for the session, so there is no login page, user table, or session dependency.

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
│       └── sections/         # Setup form split into focused sections
├── components/               # Shared UI components (navbar, tabs, cards, ...)
├── lib/
│   ├── tournament/           # Pure tournament logic (draw, fixtures, groups,
│   │                         #   standings, tiebreakers, knockout, cross-group)
│   └── db/                   # Drizzle schema, client, queries, migrations
├── proxy.ts                  # Basic-auth middleware protecting /admin
├── drizzle.config.ts         # Drizzle Kit configuration
├── next.config.ts            # Next.js configuration
└── package.json
```

The tournament rules engine in `lib/tournament/` is pure TypeScript with no I/O, which keeps it easy to unit-test (see the `*.test.ts` files there) and to reuse.

## Design principles

- Keep the implementation small and easy to extend.
- Mobile-first, responsive layouts.
- All code, UI labels, and documentation are in English.
- Avoid premature abstractions; add structure as real requirements emerge.

## Contributing

Issues and pull requests are welcome. Please open an issue first to discuss significant changes. Run `npm test` before submitting.

## License

This project is licensed under the [MIT License](./LICENSE).