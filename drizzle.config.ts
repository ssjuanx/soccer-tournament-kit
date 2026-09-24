import { defineConfig } from "drizzle-kit";

// drizzle-kit does not auto-load .env.local, so load it explicitly. Node 20.6+
// supports process.loadEnvFile; the project requires Node 20.9+.
process.loadEnvFile(".env.local");

const url = process.env.DATABASE_URL_UNPOOLED;

if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED is not set. Add the direct (non-pooled) Neon connection string to your .env.local file. DDL must run over the direct endpoint.",
  );
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations / DDL must use the direct (unpooled) endpoint.
    url,
  },
});