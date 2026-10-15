/**
 * One-time cleanup: finds duplicates already saved in the data folder and merges them, keeping all
 * links (calendar entries, recordings, notetaker sessions, sent-email records, recipients).
 *
 *   npm run cleanup:duplicates              # dry run: prints the list, changes nothing
 *   npm run cleanup:duplicates -- --apply   # backs up the files, then merges the "will merge" items
 *
 * Options: --data <folder> (default backend/data), --port <n> (default 3000; --apply refuses while
 * the app is running there, because the running app would overwrite the merged files).
 * "Needs your decision" items are only listed, never changed. Safe to re-run: after an apply, the
 * next run finds nothing to merge.
 *
 * Failure modes: unreadable/malformed JSON → stops before writing anything; a crash mid-write →
 * restore from the backup folder printed at the start (each file is written atomically).
 */
import path from 'path';
import { applyPlan } from '../services/storage/duplicateCleanup/apply';
import { backupDataSet, loadDataSet, saveDataSet } from '../services/storage/duplicateCleanup/dataSet';
import { planCleanup, PlanItem } from '../services/storage/duplicateCleanup/plan';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function appIsRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/meetings/status`, { signal: AbortSignal.timeout(2000) });
    return res.status > 0;
  } catch {
    return false; // nothing listening (or not reachable) — safe to write
  }
}

function print(plan: PlanItem[]): void {
  const merge = plan.filter((p) => p.certainty === 'merge');
  const review = plan.filter((p) => p.certainty === 'review');
  console.log(`\nWill merge (${merge.length})`);
  merge.forEach((p, i) => console.log(`  ${i + 1}. ${p.description}`));
  if (!merge.length) console.log('  — nothing —');
  console.log(`\nNeeds your decision — listed only, not changed (${review.length})`);
  review.forEach((p, i) => console.log(`  ${i + 1}. ${p.description}`));
  if (!review.length) console.log('  — nothing —');
}

async function main(): Promise<void> {
  const dataDir = path.resolve(arg('data') ?? path.join(__dirname, '..', '..', 'data'));
  const apply = process.argv.includes('--apply');
  const port = Number(arg('port') ?? 3000);
  const data = loadDataSet(dataDir);
  const plan = planCleanup(data);
  console.log(`Duplicate cleanup — ${apply ? 'APPLY' : 'dry run (nothing is changed)'} — data: ${dataDir}`);
  print(plan);
  if (!apply) {
    console.log('\nTo merge the items above: npm run cleanup:duplicates -- --apply (stop the app first)');
    return;
  }
  if (!plan.some((p) => p.certainty === 'merge')) { console.log('\nNothing to merge.'); return; }
  if (await appIsRunning(port)) {
    console.error(`\nThe app is running on port ${port}. Stop it first, otherwise it will overwrite the merged files. Nothing was changed.`);
    process.exitCode = 2;
    return;
  }
  const backupDir = path.join(dataDir, 'backups', `duplicates-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const copied = backupDataSet(dataDir, backupDir);
  console.log(`\nBackup: ${copied.length} files → ${backupDir}`);
  const changed = applyPlan(data, plan);
  saveDataSet(dataDir, data, changed);
  const left = planCleanup(loadDataSet(dataDir)).filter((p) => p.certainty === 'merge');
  console.log(JSON.stringify({ event: 'duplicate_cleanup_applied', merged: plan.filter((p) => p.certainty === 'merge').length, files: [...changed], remaining: left.length, outcome: left.length ? 'partial' : 'success' }));
  if (left.length) { console.error('Some duplicates remain after merging — restore the backup and report this.'); process.exitCode = 1; }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: 'duplicate_cleanup_failed', error_class: error instanceof SyntaxError ? 'MalformedDataFile' : error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : String(error), outcome: 'failure' }));
  process.exitCode = 1;
});
