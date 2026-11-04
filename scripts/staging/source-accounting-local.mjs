/** Local ephemeral PostgreSQL regression. Never connects to any server. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.BUNBUN_PGLITE_MODULE;
if (!modulePath) throw new Error('Set BUNBUN_PGLITE_MODULE to a local @electric-sql/pglite@0.5.15 dist/index.js');
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
try {
  await db.exec(await readFile('tests/sql/source-accounting-local-bootstrap.sql','utf8'));
  const files = ['docs/sql/staging-production-baseline.sql','docs/sql/cloud-ledger-core-staging.sql',
    'docs/sql/cloud-purchase-posting-staging.sql','docs/sql/cloud-purchase-correction-staging.sql',
    'docs/sql/cloud-purchase-service-staging.sql','docs/sql/cloud-period-expense-staging.sql',
    'docs/sql/cloud-sale-settlement-staging.sql','docs/sql/cloud-material-wip-staging.sql'];
  for (const file of files) { await db.exec(await readFile(file,'utf8')); console.log('Loaded',file); }
  await db.exec(await readFile('tests/sql/source-accounting-local-seed.sql','utf8'));
  const tests = ['tests/sql/cloud-purchase-posting-rollback.sql','tests/sql/cloud-purchase-correction-rollback.sql',
    'tests/sql/cloud-period-expense-rollback.sql','tests/sql/cloud-sale-settlement-rollback.sql','tests/sql/cloud-material-wip-rollback.sql'];
  for (const test of tests) {
    const results = await db.exec(await readFile(test,'utf8'));
    console.log(test, JSON.stringify(results.at(-1).rows));
  }
  const empty = await db.query(`select (select count(*) from bunbun_accounting.journals) journals,
    (select count(*) from public.expenses) expenses,(select count(*) from public.purchases) purchases`);
  if (Object.values(empty.rows[0]).some(x=>Number(x)!==0)) throw new Error('Test fixtures escaped rollback');
  console.log('PASS: all financial and operational fixtures rolled back; local PostgreSQL only');
} catch(error) {
  console.error(error.message, error.where || '');
  process.exitCode=1;
} finally { await db.close(); }
