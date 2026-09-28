import { defineConfig } from 'drizzle-kit';

const databaseUrl =
  process.env.DATABASE_URL ||
  'postgres://sostats:sostats_secret@localhost:5432/sostats_db';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
