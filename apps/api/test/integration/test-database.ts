import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const migrationsDir = path.join(repoRoot, 'infra/postgres/migrations');

export type TestDatabase = {
  db: PostgresJsDatabase<typeof schema>;
  sql: postgres.Sql;
  applyPostBaselineMigrations: (options?: {
    inflightPublications?: 'mark_unknown';
  }) => Promise<void>;
  drop(): Promise<void>;
};

function adminUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error(
      'TEST_DATABASE_URL is required for integration tests, e.g. postgres://user:password@localhost:5432/postgres',
    );
  }
  return value;
}

function readSql(file: string) {
  return readFileSync(file, 'utf8');
}

// ponytail: pre-007 fixture + numbered deltas after 006; from-zero bootstrap is ST15-36.1
export function postBaselineMigrationFiles() {
  return readdirSync(migrationsDir)
    .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .filter((file) => Number.parseInt(file.slice(0, 3), 10) > 6)
    .sort()
    .map((file) => path.join(migrationsDir, file));
}

export async function createTestDatabase(
  options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  const name = `sostats_int_${randomBytes(6).toString('hex')}`;
  const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }

  let pool: postgres.Sql | undefined;
  try {
    const url = new URL(adminUrl());
    url.pathname = `/${name}`;
    const sql = (pool = postgres(url.toString(), {
      max: 10,
      onnotice: () => {},
    }));
    await sql
      .unsafe(
        readSql(path.join(repoRoot, 'infra/postgres/init/001-pgvector.sql')),
      )
      .simple();
    await sql.unsafe(readSql(path.join(here, 'pre-007-schema.sql'))).simple();

    const applyPostBaselineMigrations: TestDatabase['applyPostBaselineMigrations'] =
      async (migrationOptions = {}) => {
        const connection = await sql.reserve();
        try {
          if (migrationOptions.inflightPublications) {
            await connection.unsafe(
              `set sostats.inflight_publications = '${migrationOptions.inflightPublications}'`,
            );
          }
          for (const file of postBaselineMigrationFiles()) {
            try {
              await connection.unsafe(readSql(file)).simple();
            } catch (error) {
              await connection.unsafe('rollback');
              throw error;
            }
          }
        } finally {
          if (migrationOptions.inflightPublications) {
            await connection.unsafe(`set sostats.inflight_publications = ''`);
          }
          connection.release();
        }
      };

    if (options.migrate !== false) await applyPostBaselineMigrations();

    return {
      db: drizzle(sql, { schema }),
      sql,
      applyPostBaselineMigrations,
      async drop() {
        await sql.end();
        const cleanup = postgres(adminUrl(), { max: 1, onnotice: () => {} });
        try {
          await cleanup.unsafe(`drop database if exists ${name} with (force)`);
        } finally {
          await cleanup.end();
        }
      },
    };
  } catch (error) {
    await pool?.end().catch(() => {});
    const cleanup = postgres(adminUrl(), { max: 1, onnotice: () => {} });
    try {
      await cleanup.unsafe(`drop database if exists ${name} with (force)`);
    } finally {
      await cleanup.end();
    }
    throw error;
  }
}
