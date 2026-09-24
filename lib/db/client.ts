/**
 * Neon Postgres database client for the FC Tournament app.
 *
 * Uses Neon's HTTP driver (`drizzle-orm/neon-http` + `@neondatabase/serverless`),
 * which is well suited to serverless runtimes such as Next.js Server
 * Components, Route Handlers, and Server Actions. Each query is a single HTTP
 * request to Neon's pooled endpoint, so there are no long-lived connections to
 * manage or pool.
 *
 * Reads the pooled `DATABASE_URL` (the `-pooler` endpoint) from the environment.
 * Migrations use the direct `DATABASE_URL_UNPOOLED` endpoint via
 * `drizzle.config.ts`, not this client.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema.ts";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Add it to your .env.local file (see the Neon project connection strings).",
  );
}

const sql = neon(connectionString);

export const db = drizzle({ client: sql, schema });