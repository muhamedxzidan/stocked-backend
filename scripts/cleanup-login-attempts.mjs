import 'dotenv/config';
import pg from 'pg';
const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await database.connect();
  const result = await database.query('DELETE FROM login_attempt_buckets WHERE expires_at <= clock_timestamp()');
  console.log(`Deleted ${result.rowCount} expired authentication buckets`);
} catch { console.error('Authentication bucket cleanup failed'); process.exitCode = 1; }
finally { await database.end(); }
