/**
 * Forgot the dashboard password? Removes the login (and every session) so "Create your login" appears
 * again the next time the app is opened on this computer. Meetings and other data are not touched.
 *
 *   npm run auth:reset -- --yes        (stop the app first; it refuses while the app is running)
 *
 * Options: --data <folder> (default backend/data), --port <n> (default 3000).
 */
import { existsSync, rmSync } from 'fs';
import path from 'path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const dataDir = path.resolve(arg('data') ?? path.join(__dirname, '..', '..', 'data'));
  const port = Number(arg('port') ?? 3000);
  if (!process.argv.includes('--yes')) {
    console.log('This removes the dashboard login so you can create a new one. Meetings are not touched.\nRun again with --yes to continue: npm run auth:reset -- --yes');
    return;
  }
  const running = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
  if (running) {
    console.error(`The app is running on port ${port}. Stop it first, then run this again. Nothing was changed.`);
    process.exitCode = 2;
    return;
  }
  for (const file of ['auth.json', 'sessions.json']) {
    const target = path.join(dataDir, file);
    if (existsSync(target)) rmSync(target);
  }
  console.log(JSON.stringify({ event: 'auth_login_reset', outcome: 'success' }));
  console.log('Login removed. Start the app and open it on this computer to create a new login.');
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: 'auth_login_reset_failed', error_class: error instanceof Error ? error.name : 'UnknownError', outcome: 'failure' }));
  process.exitCode = 1;
});
