/**
 * Regression test for the first release's blocking bug.
 *
 * That release refused deletion whenever a Session had a live Agent. DSH
 * registers an Agent and opens a write handle for every Session the browser has
 * loaded, so the guard refused every row a user could actually click: the button
 * appeared and the dialog opened, then always failed with "still active".
 *
 * This reproduces the real conditions — a live Agent AND a genuinely open file
 * handle on the log — and asserts the delete now succeeds. It also pins the
 * premise the old guard was based on: Node removes a file that still has an open
 * handle (it opens with FILE_SHARE_DELETE on Windows), so an open handle was
 * never a reason to refuse.
 */
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply } from './index.js';
import { encodeSegment, projectKey } from './paths.js';

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

const sandbox = await mkdtemp(join(tmpdir(), 'dsd-regress-'));
const savedHome = process.env['DSH_HOME'];
process.env['DSH_HOME'] = sandbox;

const cwd = 'C:\\work\\demo-project';
const id = 'session-99999999-8888-7777-6666-555555555555';
const sessionDir = join(sandbox, 'sessions', projectKey(cwd), encodeSegment(id));
const logFile = join(sessionDir, 'session.v4.jsonl.zstd');
const cacheDir = join(sandbox, 'storages', 'session_projcache', 'sessions');
const cacheFile = join(cacheDir, `${id}.json`);

try {
  await check('Node really can remove a file with an open handle (guard premise)', async () => {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(logFile, 'payload');
    // Hold the handle open exactly as the live persistence writer does.
    const fd = openSync(logFile, 'r+');
    try {
      await rm(logFile, { force: true });
      assert.equal(existsSync(logFile), false, 'file survived an open-handle unlink');
    } finally {
      closeSync(fd);
    }
  });

  await check('a LIVE idle Session with an open log handle is deleted, not refused', async () => {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(logFile, 'payload');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile, '{}');
    const held = openSync(logFile, 'r+');

    let route;
    apply({
      connection: { fetch: { register(r) { route = r; return async () => {}; } } },
      get: (name) => ({
        // The old guard's trigger: a live Agent for this exact Session.
        agents: { get: () => ({ id }) },
        sessionPersistence: { stat: async () => ({ header: { cwd } }) },
        // A settled Turn, so no in-progress work blocks the delete.
        sessions: {
          get: () => ({
            seq: 7,
            eventAt: (seq) => (seq === 6 ? { type: 'turn/end' } : undefined),
            snapshotEvents: () => [],
          }),
        },
        workspaceRegistry: {
          list: () => [{ sessionIds: [id], detachSession: async () => {} }],
          unpinSession: async () => {},
        },
      })[name],
    });

    try {
      const response = await route.fetch(new Request('http://127.0.0.1/api/session.delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: id }),
      }));
      const body = await response.json();
      assert.equal(response.status, 200, `expected 200, got ${String(response.status)}: ${JSON.stringify(body)}`);
      assert.equal(body.ok, true);
      assert.deepEqual(body.removed, { sessionDir: true, projectionCache: true, workspace: true });
    } finally {
      closeSync(held);
    }
    assert.equal(existsSync(sessionDir), false, 'the loaded Session directory survived');
    assert.equal(existsSync(cacheFile), false, 'the loaded Session projection cache survived');
  });

  await check('an in-progress Turn is still refused (the guard that must stay)', async () => {
    let route;
    apply({
      connection: { fetch: { register(r) { route = r; return async () => {}; } } },
      get: (name) => ({
        sessionPersistence: { stat: async () => ({ header: { cwd } }) },
        sessions: {
          get: () => ({
            seq: 7,
            eventAt: (seq) => (seq === 6 ? { type: 'turn/start' } : undefined),
            snapshotEvents: () => [],
          }),
        },
      })[name],
    });
    const response = await route.fetch(new Request('http://127.0.0.1/api/session.delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id }),
    }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'session/busy');
  });
} finally {
  if (savedHome === undefined) delete process.env['DSH_HOME'];
  else process.env['DSH_HOME'] = savedHome;
  await rm(sandbox, { recursive: true, force: true });
  console.log(`\n  cleaned ${sandbox}`);
}

console.log(failures === 0 ? '\nALL REGRESSION CHECKS PASSED' : `\n${String(failures)} REGRESSION CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
