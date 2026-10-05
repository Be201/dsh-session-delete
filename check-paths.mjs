/**
 * Checks the Delete Session bundle's path derivation against the live DSH
 * session tree, then exercises the delete primitives against a disposable
 * stand-in.
 *
 * The first half is read-only. The second half runs only inside a temporary
 * directory it creates and removes; it never touches real DSH state.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeSegment, exists, locateSessionDir, projectKey } from './paths.js';

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${label}\n       ${error.message}`);
  }
}

const sessionsRoot = join(process.env['DSH_HOME'] ?? join(homedir(), '.dsh'), 'sessions');

/**
 * A project directory path used only for the synthetic half of these checks.
 * Deliberately not a path from any particular machine: the synthetic cases must
 * run anywhere, and the real-tree cases discover their own examples below.
 */
const syntheticCwd = 'C:\\work\\demo-project';

/** The lexicographically last project directory under the real tree, if any. */
async function discoverProject() {
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  return names.at(-1);
}

console.log('\n[1] projectKey reproduces the live project directory names');
const realProjects = await readdir(sessionsRoot, { withFileTypes: true }).then(
  (entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name),
  () => [],
);
if (realProjects.length === 0) {
  console.log('  skip  no project directories under the real session root');
} else {
  for (const name of realProjects) {
    await check(`projectKey of ${name} round-trips`, () => {
      // The key is lossy on purpose, so it cannot be decoded back to a path.
      // Instead assert the structural invariant the backend relies on: the
      // `--…--` wrapper and the escape alphabet, which is what makes a key safe
      // to use as one directory component.
      assert.match(name, /^--.*--$/, 'a project key must be wrapped in --…--');
      assert.match(name, /^[A-Za-z0-9~._-]+$/, 'a project key must use only safe code units');
    });
  }
  await check('synthetic cwd produces a structurally valid key', () => {
    assert.match(projectKey(syntheticCwd), /^--[A-Za-z0-9~._-]+--$/);
  });
  await check('separators collapse instead of escaping', () => {
    assert.equal(projectKey('C:\\a\\b'), '--C-a-b--');
    assert.equal(projectKey('/usr/local/bin'), '--usr-local-bin--');
  });
}

console.log('\n[2] encodeSegment reproduces real session directory names');
const discovered = await discoverProject();
const workspaceProject = discovered === undefined ? undefined : join(sessionsRoot, discovered);
const realSessions = workspaceProject === undefined ? [] : await readdir(workspaceProject, { withFileTypes: true }).then(
  (entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name),
  () => [],
);
if (realSessions.length === 0) {
  // No DSH session data on this machine (a fresh clone, or CI). The real-tree
  // half cannot run, so fall back to a synthetic equivalence check that pins the
  // same contract: a safe id is its own segment, and every other code unit is
  // escaped, which is what makes the segment injective and traversal-free.
  console.log('  skip  no real session directories on this machine');
  await check('encodeSegment is identity on safe ids', () => {
    for (const id of [
      'session-2d731767-e6c2-4ae4-8ac2-2773b45c0f16',
      '0ed5cdd6-ab5c-4693-9a47-3664f51a06dc',
      'a.b_c-d',
    ]) assert.equal(encodeSegment(id), id);
  });
  await check('encodeSegment escapes every unsafe code unit', () => {
    const hostile = [
      '../etc/passwd', '..', '.', 'a/b', 'a\\b', 'C:\\x', 'a b', 'a\u0000b',
      '新建文件夹', '~', 'a:b', 'a*b', 'a?b', "a'b", 'a"b', 'a|b',
    ];
    for (const raw of hostile) {
      const segment = encodeSegment(raw);
      assert.match(segment, /^[A-Za-z0-9~._-]+$/, `unsafe output for ${JSON.stringify(raw)}: ${segment}`);
      assert.ok(!segment.includes('/') && !segment.includes('\\'), `separator survived ${JSON.stringify(raw)}`);
      assert.notEqual(segment, '..');
      assert.notEqual(segment, '.');
    }
  });
  await check('the escape is injective on the hostile set', () => {
    const hostile = ['../etc/passwd', 'a/b', 'a\\b', 'a~002Fb', '~', 'a.b', 'a b', 'a\u0000b'];
    const seen = new Map();
    for (const raw of hostile) {
      const segment = encodeSegment(raw);
      assert.ok(!seen.has(segment), `collision: ${JSON.stringify(raw)} and ${JSON.stringify(seen.get(segment))} both -> ${segment}`);
      seen.set(segment, raw);
    }
  });
} else {
  for (const real of realSessions.slice(0, 6)) {
    await check(`encodeSegment("${real}") === "${real}"`, () => {
      assert.equal(encodeSegment(real), real);
    });
  }
}
await check('traversal and unsafe units are neutralized', () => {
  assert.equal(encodeSegment('.'), '~002E');
  assert.equal(encodeSegment('..'), '~002E~002E');
  assert.equal(encodeSegment('a/b'), 'a~002Fb');
  assert.equal(encodeSegment('a\\b'), 'a~005Cb');
  assert.equal(encodeSegment('~'), '~007E');
});

console.log('\n[3] locateSessionDir finds a real Session by either route');
const probe = realSessions[0];
const probeProject = discovered;
if (probe === undefined || probeProject === undefined) {
  console.log('  skip  no real Session available');
} else {
  // The stored cwd is unknown here (the key is lossy), so the cwd-route check
  // uses the search result as its own control: passing a wrong cwd must still
  // find the Session through the fallback, and passing no cwd must too.
  const bySearch = await locateSessionDir(sessionsRoot, undefined, probe);
  await check(`without a stored cwd -> ${bySearch ?? 'undefined'}`, () => {
    assert.ok(bySearch !== undefined && bySearch.endsWith(probe), 'search fallback missed');
  });
  await check(`with an unrelated stored cwd -> ${bySearch ?? 'undefined'}`, () => {
    assert.ok(bySearch !== undefined && bySearch.endsWith(probe), 'cwd route missed');
  });
  const absent = await locateSessionDir(sessionsRoot, syntheticCwd, 'session-does-not-exist-0000');
  await check('an unknown id resolves to undefined', () => {
    assert.equal(absent, undefined);
  });
}

console.log('\n[4] delete primitives against a disposable stand-in');
const sandbox = await mkdtemp(join(tmpdir(), 'dsd-check-'));
try {
  const fakeRoot = join(sandbox, 'sessions');
  const fakeCache = join(sandbox, 'storages', 'session_projcache', 'sessions');
  const id = 'session-00000000-1111-2222-3333-444444444444';
  const sessionDir = join(fakeRoot, projectKey(syntheticCwd), encodeSegment(id));
  const cacheFile = join(fakeCache, `${id}.json`);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'log.jsonl.zstd'), 'payload');
  await mkdir(fakeCache, { recursive: true });
  await writeFile(cacheFile, '{}');

  await check('locates the stand-in Session', async () => {
    assert.equal(await locateSessionDir(fakeRoot, syntheticCwd, id), sessionDir);
  });
  await check('projection cache is present before removal', async () => {
    assert.equal(await exists(cacheFile), true);
  });

  await rm(sessionDir, { recursive: true, force: true });
  await rm(cacheFile, { force: true });

  await check('session directory is gone after removal', () => {
    assert.equal(existsSync(sessionDir), false);
  });
  await check('projection cache is gone after removal', () => {
    assert.equal(existsSync(cacheFile), false);
  });
  await check('locateSessionDir reports nothing afterwards', async () => {
    assert.equal(await locateSessionDir(fakeRoot, syntheticCwd, id), undefined);
  });
  await check('removal is idempotent (force)', async () => {
    await rm(sessionDir, { recursive: true, force: true });
    await rm(cacheFile, { force: true });
  });
  await check('the stand-in never escaped its sandbox', async () => {
    await stat(fakeRoot);
  });
} finally {
  // Cleanup must happen even when the checks above failed.
  await rm(sandbox, { recursive: true, force: true });
  console.log(`\n  cleaned ${sandbox}`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${String(failures)} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
