/**
 * Exercises the Host half's registered route handler end-to-end.
 *
 * `apply` is called with a stub context that captures the route it registers;
 * the captured handler is then invoked with real `Request` objects against a
 * disposable `DSH_HOME`, so the status/body contract, the live-Session refusal,
 * the input guard, and the actual on-disk removal are all exercised without
 * touching the real DSH home.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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

const sandbox = await mkdtemp(join(tmpdir(), 'dsd-route-'));
const savedHome = process.env['DSH_HOME'];
process.env['DSH_HOME'] = sandbox;

const cwd = 'C:\\work\\demo-project';
const id = 'session-11111111-2222-3333-4444-555555555555';
const sessionDir = join(sandbox, 'sessions', projectKey(cwd), encodeSegment(id));
const cacheDir = join(sandbox, 'storages', 'session_projcache', 'sessions');
const cacheFile = join(cacheDir, `${id}.json`);

/**
 * Register the plugin against a stub context and return the route it captured.
 *
 * A real Cordis context reaches optional services through `ctx.get(name)` and
 * hard dependencies as plain properties, so the stub reproduces exactly that.
 *
 * @param services - optional services the composition provides.
 * @returns the captured route.
 */
function captureRoute(services = {}) {
  let captured;
  apply({
    ...services,
    connection: {
      fetch: {
        register(registered) {
          captured = registered;
          return async () => {};
        },
      },
    },
    get: (name) => services[name],
  });
  return captured;
}

/** POST one JSON body to the route. */
function post(routeToUse, body) {
  return routeToUse.fetch(new Request('http://127.0.0.1/api/session.delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

const route = captureRoute();

try {
  await check('apply registers the declared path and method', () => {
    assert.ok(route !== undefined, 'no route registered');
    assert.equal(route.path, '/api/session.delete');
    assert.deepEqual(route.methods, ['POST']);
    assert.equal(typeof route.fetch, 'function');
  });

  await check('malformed JSON is refused with 400', async () => {
    const response = await post(route, '{not json');
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'request/malformed');
  });

  for (const bad of [undefined, null, 42, '', 'a/b', '../etc', 'x'.repeat(201), 'has space']) {
    await check(`invalid sessionId ${JSON.stringify(bad)} is refused with 400`, async () => {
      const response = await post(route, { sessionId: bad });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'request/sessionId');
    });
  }

  await check('a valid but unknown Session answers 404', async () => {
    // A composition that HAS persistence, reporting no such stored Session.
    const knownRoute = captureRoute({ sessionPersistence: { stat: async () => undefined } });
    const response = await post(knownRoute, { sessionId: 'session-unknown-0000' });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'session/not-found');
  });

  // Build the stand-in the way the persistence backend lays one out. Each case
  // that removes it recreates it first, so ordering cannot silently pass a case.
  const seedArtifacts = async () => {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'log.jsonl.zstd'), 'payload');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile, '{}');
  };
  await seedArtifacts();

  await check('a Session with an open Turn is refused with 409 and nothing is removed', async () => {
    // A live Session whose event tail is inside a Turn (last event turn/start).
    const busyRoute = captureRoute({
      sessionPersistence: { stat: async () => ({ header: { cwd } }) },
      sessions: {
        get: () => ({
          seq: 7,
          eventAt: (seq) => (seq === 6 ? { type: 'turn/start' } : undefined),
          snapshotEvents: () => [],
        }),
      },
    });
    const refused = await post(busyRoute, { sessionId: id });
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).code, 'session/busy');
    assert.equal(existsSync(sessionDir), true, 'refusal must not remove anything');
    assert.equal(existsSync(cacheFile), true, 'refusal must not remove anything');
  });

  await check('a LIVE but idle Session is allowed (the regression that shipped)', async () => {
    // This is the case the first release wrongly refused: DSH keeps an Agent and
    // an open write handle for every loaded Session, so refusing on liveness
    // refused every row the user could click.
    const idleRoute = captureRoute({
      sessionPersistence: { stat: async () => ({ header: { cwd } }) },
      // A live Agent is registered — the old guard's trigger condition.
      agents: { get: () => ({ id }) },
      sessions: {
        get: () => ({
          seq: 7,
          eventAt: (seq) => (seq === 6 ? { type: 'turn/end' } : undefined),
          snapshotEvents: () => [],
        }),
      },
    });
    const response = await post(idleRoute, { sessionId: id });
    const body = await response.json();
    assert.equal(response.status, 200, `expected the delete to be allowed, got ${JSON.stringify(body)}`);
    assert.equal(body.ok, true);
    assert.equal(existsSync(sessionDir), false, 'idle Session directory survived');
  });

  await seedArtifacts();

  await check('a successful delete removes both artifacts and reports what went', async () => {
    const detached = [];
    const okRoute = captureRoute({
      sessionPersistence: { stat: async () => ({ header: { cwd } }) },
      workspaceRegistry: {
        list: () => [{
          sessionIds: [id],
          detachSession: async (sessionId) => { detached.push(sessionId); },
        }],
        unpinSession: async () => {},
      },
    });
    const response = await post(okRoute, { sessionId: id });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.removed, { sessionDir: true, projectionCache: true, workspace: true });
    assert.equal(existsSync(sessionDir), false, 'Session directory survived');
    assert.equal(existsSync(cacheFile), false, 'projection cache survived');
    assert.deepEqual(detached, [id], 'workspace accounting was not released');
  });

  await check('a second delete of the same Session answers 404 (idempotent)', async () => {
    // The header is still readable through persistence, but the directory is gone.
    const repeatRoute = captureRoute({ sessionPersistence: { stat: async () => ({ header: { cwd } }) } });
    const response = await post(repeatRoute, { sessionId: id });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'session/not-found');
  });

  await check('a missing persistence service answers 500 service/unavailable', async () => {
    const noPersistence = captureRoute();
    const response = await post(noPersistence, { sessionId: id });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'service/unavailable');
  });

  await check('a persistent Session whose cwd is gone is still found by search', async () => {
    // Recreate the stand-in under a project directory the header no longer names.
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'log.jsonl.zstd'), 'payload');
    const orphanRoute = captureRoute({
      sessionPersistence: { stat: async () => ({ header: { cwd: 'C:\\work\\elsewhere' } }) },
    });
    const response = await post(orphanRoute, { sessionId: id });
    assert.equal(response.status, 200);
    assert.equal(existsSync(sessionDir), false, 'search fallback did not find the directory');
  });

  await check('stale ledger row converges instead of 404 (the out-of-band case)', async () => {
    // Stored artifacts are gone — but the workspace still lists the Session, so
    // the sidebar still shows a row. The user clicked THAT row; answering it
    // with "not found" contradicts what they see. The ledger must converge.
    // Reproduces `session-452cf45f…` in the wild: dir+cache+projcache all gone,
    // only the stale row remained.
    const detached = [];
    const staleRoute = captureRoute({
      // No stored artifacts at all.
      sessionPersistence: { stat: async () => undefined },
      workspaceRegistry: {
        list: () => [{
          sessionIds: ['session-stale-0000', id],
          detachSession: async (sid) => { detached.push(sid); },
        }],
        unpinSession: async () => {},
      },
    });
    const response = await post(staleRoute, { sessionId: id });
    const body = await response.json();
    assert.equal(response.status, 200, `expected ledger convergence, got ${JSON.stringify(body)}`);
    assert.equal(body.ok, true);
    assert.equal(body.removed.sessionDir, false, 'nothing was on disk');
    assert.equal(body.removed.projectionCache, false, 'no cache was on disk');
    assert.equal(body.removed.workspace, true, 'ledger must be released');
    assert.deepEqual(detached, [id], 'the stale entry must be detached');
  });

  await check('a Session never seen anywhere still answers 404', async () => {
    // Nothing on disk, nothing in any ledger: 404 is honest here.
    const neverRoute = captureRoute({
      sessionPersistence: { stat: async () => undefined },
      workspaceRegistry: { list: () => [], unpinSession: async () => {} },
    });
    const response = await post(neverRoute, { sessionId: id });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'session/not-found');
  });
} finally {
  if (savedHome === undefined) delete process.env['DSH_HOME'];
  else process.env['DSH_HOME'] = savedHome;
  await rm(sandbox, { recursive: true, force: true });
  console.log(`\n  cleaned ${sandbox}`);
}

console.log(failures === 0 ? '\nALL ROUTE CHECKS PASSED' : `\n${String(failures)} ROUTE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
