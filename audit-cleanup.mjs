/**
 * Audit whether a deleted Session left anything behind.
 *
 * Read-only. Compares the three stores the plugin owns as one relation and
 * reports inconsistencies in either direction:
 *   - a projection cache with no Session directory (a leftover the plugin owns)
 *   - a Session id still in the workspace ledger (accounting not released)
 *   - a textual reference to the target anywhere in DSH state
 *
 * It also reports ledger/disk differences it finds for OTHER Sessions, but
 * classifies them as observations rather than failures: Sessions outside the
 * selected Workspaces are legitimately unaccounted, and attributing those to
 * this deletion would be wrong.
 *
 * Usage: node audit-cleanup.mjs <sessionId>
 */
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

const target = process.argv[2];
if (target === undefined) {
  console.error('usage: node audit-cleanup.mjs <sessionId>');
  process.exit(2);
}

const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh');
const sessionsRoot = join(home, 'sessions');
const cacheRoot = join(home, 'storages', 'session_projcache', 'sessions');
const workspaceFile = join(home, 'storages', 'workspace.json');

/** Every Session directory on disk, as `{project, id, files}`. */
async function diskSessions() {
  const out = [];
  for (const project of await readdir(sessionsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!project.isDirectory()) continue;
    const dir = join(sessionsRoot, project.name);
    for (const session of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!session.isDirectory()) continue;
      out.push({
        project: project.name,
        id: session.name,
        files: await readdir(join(dir, session.name)).catch(() => []),
      });
    }
  }
  return out;
}

const onDisk = await diskSessions();
const cacheFiles = new Set(
  (await readdir(cacheRoot).catch(() => [])).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)),
);
const ledger = JSON.parse(await readFile(workspaceFile, 'utf8'));
const ledgerIds = new Set(Object.values(ledger.tables.workspaces).flatMap((w) => w.sessionIds));
const archived = new Set(ledger.global.archivedSessionIds);
const pinned = new Set(ledger.global.pinnedSessionIds);
const diskIds = new Set(onDisk.map((s) => s.id));

const failures = [];
const observations = [];
const line = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  !!  '} ${label}${detail === '' ? '' : `  ${detail}`}`);
  if (!ok) failures.push(label);
};
const note = (label) => {
  console.log(`  --   ${label}`);
  observations.push(label);
};

console.log(`\nTARGET  ${target}`);
console.log(`HOME    ${home}\n`);

console.log('[1] the target is gone from every store');
line('session directory removed', !diskIds.has(target));
line('projection cache removed', !cacheFiles.has(target));
line('absent from workspace sessionIds', !ledgerIds.has(target));
line('absent from archivedSessionIds', !archived.has(target));
line('absent from pinnedSessionIds', !pinned.has(target));

console.log('\n[2] no orphaned artifacts remain (either direction)');
for (const id of cacheFiles) line(`cache entry ${id} has a Session directory`, diskIds.has(id));
for (const s of onDisk) {
  if (cacheFiles.has(s.id)) continue;
  note(`${s.id} has no projection cache (rebuilt on demand — not a leak)`);
}
line('no empty Session directories left behind', onDisk.every((s) => s.files.length > 0));

console.log('\n[3] the ledger still agrees with the disk for what it accounts for');
for (const id of ledgerIds) line(`ledger Session ${id} exists on disk`, diskIds.has(id));

console.log('\n[4] observations for OTHER Sessions (pre-existing, not this deletion)');
for (const s of onDisk) {
  if (ledgerIds.has(s.id)) continue;
  note(`${s.id} is on disk but not in any Workspace ledger (project ${s.project})`);
}

console.log('\n[5] no textual reference to the target in DSH state');
const stateFiles = [
  workspaceFile,
  join(home, 'profiles', 'desktop', 'cordis.patch.yml'),
  join(home, 'profiles', 'desktop', 'package.json'),
  join(home, 'llm-deepseek', 'files-v3.json'),
];
const referencing = [];
for (const file of stateFiles) {
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text !== undefined && text.includes(target)) referencing.push(relative(home, file));
}
line(
  'no state file mentions the target',
  referencing.length === 0,
  referencing.length === 0 ? '' : `found in: ${referencing.join(', ')}`,
);

console.log('\n[6] nothing of the target survives on disk under any name');
const strays = onDisk.filter((s) => s.id === target || s.files.some((f) => f.includes(target)));
line('no directory or file carries the target id', strays.length === 0);

if (observations.length > 0) {
  console.log(`\nOBSERVATIONS (unrelated to this deletion, ${String(observations.length)}):`);
  for (const o of observations) console.log(`  - ${o}`);
}
console.log(
  failures.length === 0
    ? '\nCLEAN — the deleted Session left nothing behind.\n'
    : `\n${String(failures.length)} PROBLEM(S):\n${failures.map((p) => `  - ${p}`).join('\n')}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
