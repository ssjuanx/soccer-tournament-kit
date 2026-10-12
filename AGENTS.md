<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Soccer Tournament Kit — Agent Guide

This file orients AI coding agents working on this repository. Read it before making changes. The human-facing overview lives in `README.md`.

## What this is

An open-source soccer tournament manager. One admin configures the tournament, enters participants + assigned soccer teams, and records match scores. Everyone else reads a public, read-only, mobile-friendly site (standings, fixtures, brackets, rules). Reference deployment: Vercel + Neon Postgres, both swappable.

## Architecture

Two layers, kept strictly separate:

1. **Pure tournament engine** — `lib/tournament/` (`types`, `groups`, `draw`, `fixtures`, `standings`, `tiebreakers`, `knockout`, `cross-group`). No React, Next.js, Drizzle, Neon, or any I/O. Pure functions, fully unit-tested with `*.test.ts`. Derived values (standings, qualification, bracket advancement) are *recomputed* here and never persisted.
2. **Persistence + UI** — `lib/db/` (Drizzle schema, client, queries, migrations) and `app/` (App Router). Server Components and Server Actions read/write stored facts and feed them into the pure engine.

Key invariant: **persist facts, not derived data.** Stored facts = tournament config/status, participant identity, draw order, assigned team, group assignment, match pairings, match scores. Do not add columns/tables for wins, points, GD, position, qualification, or bracket advancement.

Important engine functions: `getGroupSizes`, `getGroupIndexForDrawOrder`, `getGroupLabel`, `buildSetup`, `generateGroupFixtures`, `validateScore`, `calculateStandings`, `getQualifiedParticipants`, `generateBracket`, `advanceBracket`. The single-elimination engine supports non-power-of-two fields by awarding byes to the highest seeds; reuse it for any bracket (Championship, Consolation, …) rather than writing a second algorithm.

## Conventions

- All code, UI labels, and docs in English.
- Mobile-first, responsive Tailwind layouts.
- Identifiers are `text` (string IDs from the domain model).
- Enums are stored as `text` with TS-level union types, **not** native Postgres enums (avoids a migration per new value). Keep the value lists in `lib/db/schema.ts` in sync with the unions in `lib/tournament/types.ts`.
- Keep it simple: no speculative features, no generic SaaS abstractions, no unnecessary dependencies. Build only what a current requirement needs.
- One administrator, many read-only viewers. Do not add multi-user accounts, orgs, or roles unless explicitly requested.
- Tiebreaker order is tournament-owned config; points are always primary and never configurable. The configurable keys are `goal_difference`, `goals_for`, `head_to_head`, `manual`; `manual` is terminal and cohort-scoped. `ALL_TIEBREAKER_KEYS` in `standings.ts` drives serialization — extend it there.

## Environment variables

Required (see `.env.example`):

- `DATABASE_URL` — pooled Postgres connection string, used by the app at runtime.
- `DATABASE_URL_UNPOOLED` — direct Postgres connection string, used for migrations/DDL (`drizzle.config.ts` loads it). DDL must run over the direct endpoint.
- `ADMIN_PASSWORD` — password for HTTP Basic auth on `/admin` (username `admin`). Missing in production → `/admin` returns `503`; missing in dev → `/admin` is open.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server (http://localhost:3000) |
| `npm run build` | Production build |
| `npm start` | Run the production server |
| `npm test` | Unit tests (Node built-in runner) over `lib/tournament/*.test.ts` and `lib/db/*.test.ts` |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply Drizzle migrations (uses `DATABASE_URL_UNPOOLED`) |

When you change `lib/db/schema.ts`, run `npm run db:generate` to produce a new migration under `lib/db/migrations/`, then `npm run db:migrate` to apply it. The migrations and `meta/` snapshots are committed and are the canonical schema.

## Database

Drizzle schema: `lib/db/schema.ts`. Client: `lib/db/client.ts` (Neon HTTP driver — `drizzle-orm/neon-http` + `@neondatabase/serverless`, one HTTP request per query, no long-lived connections). Queries/actions: `lib/db/actions.ts`, `matches.ts`, `tournaments.ts`, `rules.ts`, `bracket-views.ts`, `setup.ts`. Seven tables — see README → *Database schema* for the column reference and `lib/db/migrations/*.sql` for the canonical SQL.

## Testing

Pure logic is tested via `npm test` (Node's built-in test runner, no test framework dependency). Keep new engine logic covered with tests in the same directory as the module (`*.test.ts`). Run `npm test` before finishing any change to `lib/`.

## Admin & auth

`/admin` is protected by HTTP Basic auth in `proxy.ts` (matcher `/admin/:path*`). Server Actions in `app/admin/` mutate state; public routes under `app/` are read-only Server Components. Knockout brackets block rule changes once a bracket exists (see the Server Actions).

## Deployment

Reference: Vercel + Neon. Set `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `ADMIN_PASSWORD` on the host. Apply migrations once against the direct endpoint. Any Postgres provider and any Next.js-capable host work — no code changes needed as long as Postgres is spoken and the three env vars are provided.

## Working rules

- Do not commit local dev context, design-decision logs, or agent tooling. The repo ships only the project + `README.md` + this file.
- Do not persist derived data.
- Run `npm test` before considering engine work done.
