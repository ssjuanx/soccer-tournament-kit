# FC Tournament

An open-source soccer tournament manager. One administrator enters
participants, teams, and match scores manually. Everyone else visits a public,
read-only website to follow the group stage and knockout bracket.

## Status

This repository contains the initial foundation: a Next.js app with a landing
page and placeholder routes. Tournament logic, data entry, and persistence are
not implemented yet and will be added incrementally.

## Planned features

- **Group stage** &mdash; teams drawn into groups, round-robin matches, and
  automatically computed standings with points and tiebreakers.
- **Knockout bracket** &mdash; a single-elimination bracket built from the
  qualified teams, from the round of 16 through the final.
- **Public site** &mdash; read-only views for standings, matches, and the
  bracket.
- **Admin area** &mdash; a single administrator manages participants, teams,
  and match scores.

> Persistence (database, storage) and authentication are intentionally
> undecided for now. They will be chosen when data entry is implemented.

## Tech stack

- [Next.js](https://nextjs.org) with the App Router
- [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS](https://tailwindcss.com)
- Minimal dependencies by design

## Getting started

Requires Node.js 20.9 or newer (developed with Node 24).

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