// Applies pending migrations to the Supabase database, all in one
// transaction, and reports exactly which file and line failed. Applied
// migrations are recorded in supabase_migrations.schema_migrations (the table
// the Supabase CLI uses), so `supabase db push` and this script agree.
// On the first run it also loads the sample questions.
//
// Needs SUPABASE_DB_URL in .env.local (Dashboard → Connect). Vite never ships
// non-VITE_ variables to the browser, so the password stays on this machine.
//
//   npm run db:apply            apply pending migrations
//   npm run db:apply -- --dry   list what would run
import pg from 'pg';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dry = process.argv.includes('--dry');

function envFromFile(name, file = join(root, '.env.local')) {
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

const url = process.env.SUPABASE_DB_URL ?? envFromFile('SUPABASE_DB_URL');
if (!url) {
  console.error('Set SUPABASE_DB_URL in .env.local (Dashboard → Connect).');
  process.exit(1);
}

// Supabase uses its own CA; the connection is still encrypted.
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
} catch (e) {
  console.error(`Could not connect: ${e.message}`);
  if (/ENOTFOUND|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT/.test(e.code ?? e.message)) {
    console.error('The direct connection (db.<ref>.supabase.co) is IPv6-only on the free plan.');
    console.error('Use the "Session pooler" string from Dashboard → Connect instead.');
  }
  process.exit(1);
}

await client.query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
  alter table supabase_migrations.schema_migrations add column if not exists statements text[];
  alter table supabase_migrations.schema_migrations add column if not exists name text;
`);
const applied = new Set((await client.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version));

const dir = join(root, 'supabase', 'migrations');
const pending = readdirSync(dir)
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort()
  .map((f) => ({ file: f, version: f.split('_')[0], name: f.replace(/^\d+_/, '').replace(/\.sql$/, '') }))
  .filter((m) => !applied.has(m.version));

const firstRun = applied.size === 0;
if (!pending.length) {
  console.log('Database is up to date.');
  await client.end();
  process.exit(0);
}
console.log(`${pending.length} migration(s) to apply${firstRun ? ' + sample questions' : ''}:`);
pending.forEach((m) => console.log(`  - ${m.file}`));
if (dry) {
  await client.end();
  process.exit(0);
}

const steps = pending.map((m) => ({ ...m, sql: readFileSync(join(dir, m.file), 'utf8') }));
if (firstRun) steps.push({ file: 'seed.sql', sql: readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8') });

await client.query('begin');
for (const step of steps) {
  try {
    await client.query(step.sql);
    if (step.version) {
      await client.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)', [step.version, step.name]);
    }
    console.log(`  ✓ ${step.file}`);
  } catch (e) {
    await client.query('rollback');
    const pos = Number(e.position ?? 0);
    const line = pos ? step.sql.slice(0, pos).split('\n').length : '?';
    console.error(`\n✗ ${step.file} (line ${line}): ${e.message}`);
    if (e.where) console.error(`  at ${e.where}`);
    console.error('Rolled back: the database is unchanged.');
    await client.end();
    process.exit(1);
  }
}
await client.query('commit');
await client.query(`notify pgrst, 'reload schema'`);
await client.end();
console.log('\nDone.');
