import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

export async function createAuthTestDatabase() {
  const originalUrl = process.env.DATABASE_URL;
  if (!originalUrl) throw new Error('Local development DATABASE_URL required');
  const source = new URL(originalUrl);
  if (
    !['localhost', '127.0.0.1'].includes(source.hostname) ||
    source.pathname !== '/stocked_dev'
  )
    throw new Error(
      'Tests only accept local stocked_dev as the source configuration',
    );
  const name = `stocked_auth_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: source.toString() });
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const target = new URL(source);
    target.pathname = `/${name}`;
    const connection = new pg.Client({ connectionString: target.toString() });
    try {
      await connection.connect();
      const migrations = new URL('../../prisma/migrations/', import.meta.url);
      const directories = (await readdir(migrations, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      for (const directory of directories)
        await connection.query(
          await readFile(
            new URL(`${directory}/migration.sql`, migrations),
            'utf8',
          ),
        );
    } finally {
      await connection.end();
    }
    return {
      url: target.toString(),
      async dispose() {
        try {
          await admin.query(`DROP DATABASE "${name}"`);
        } finally {
          await admin.end();
        }
      },
    };
  } catch (error) {
    try {
      if (created) await admin.query(`DROP DATABASE "${name}"`);
    } finally {
      await admin.end();
    }
    throw error;
  }
}
