/** Local ephemeral PostgreSQL regression. Never connects to any server. */
import { readFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.BUNBUN_PGLITE_MODULE;
if (!modulePath) throw new Error('Set BUNBUN_PGLITE_MODULE to a local @electric-sql/pglite@0.5.15 dist/index.js');
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
async function readSql(file, stack=[]) {
 const path=resolve(file);
 if(!path.startsWith(resolve('.')+sep)||stack.includes(path))throw Error('Invalid SQL fixture include');
 const lines=(await readFile(path,'utf8')).split('\n'),out=[];
 for(const line of lines){const include=/^\\ir\s+([A-Za-z0-9_./-]+)\s*$/.exec(line);out.push(include?await readSql(resolve(dirname(path),include[1]),[...stack,path]):line);}
 return out.join('\n');
}
try {
  await db.exec(await readFile('tests/sql/source-accounting-local-bootstrap.sql','utf8'));
  const files = ['docs/sql/staging-production-baseline.sql','docs/sql/cloud-ledger-core-staging.sql','docs/sql/cloud-stock-writers-staging.sql',
    'docs/sql/cloud-purchase-posting-staging.sql','docs/sql/cloud-purchase-correction-staging.sql',
    'docs/sql/cloud-purchase-service-staging.sql','docs/sql/cloud-period-expense-staging.sql',
    'docs/sql/cloud-sale-settlement-staging.sql','docs/sql/cloud-material-wip-staging.sql','docs/sql/cloud-production-cost-staging.sql','docs/sql/cloud-product-cost-flow-staging.sql','docs/sql/cloud-cafe-report-staging.sql','docs/sql/cloud-cafe-ledger-staging.sql','docs/sql/cloud-cafe-exceptions-staging.sql','docs/sql/cloud-owner-financial-report-staging.sql'];
  for (const file of files) { await db.exec(await readSql(file)); console.log('Loaded',file); }
  await db.exec(await readFile('tests/sql/source-accounting-local-seed.sql','utf8'));
  const tests = ['tests/sql/cloud-purchase-posting-rollback.sql','tests/sql/cloud-purchase-correction-rollback.sql',
    'tests/sql/cloud-period-expense-rollback.sql','tests/sql/cloud-sale-settlement-rollback.sql','tests/sql/cloud-material-wip-rollback.sql','tests/sql/cloud-production-cost-rollback.sql','tests/sql/cloud-product-cost-flow-rollback.sql','tests/sql/cloud-cafe-report-rollback.sql','tests/sql/cloud-cafe-ledger-rollback.sql','tests/sql/cloud-cafe-exceptions-rollback.sql','tests/sql/cloud-owner-financial-report-rollback.sql'];
  for (const test of tests) {
    const results = await db.exec(await readSql(test));
    console.log(test, JSON.stringify(results.at(-1).rows));
  }
  const empty = await db.query(`select (select count(*) from bunbun_accounting.journals) journals,
    (select count(*) from public.expenses) expenses,(select count(*) from public.purchases) purchases`);
  if (Object.values(empty.rows[0]).some(x=>Number(x)!==0)) throw new Error('Test fixtures escaped rollback');
  console.log('PASS: all financial and operational fixtures rolled back; local PostgreSQL only');
} catch(error) {
  console.error(error.message, error.where || '', error.position || '');
  process.exitCode=1;
} finally { await db.close(); }
