/**
 * Host half of the Delete Session bundle.
 *
 * DSH has no Session-deletion seam: `sessionPersistence` is append-only, and its
 * own contract states that logs accumulate under the persistence root until an
 * external actor removes them ("the seam has no delete interface"). This plugin
 * is that external actor. It is the single implementation of the operation; the
 * browser half only calls it.
 *
 * One authenticated exact Fetch route, registered through `ctx.connection`, is
 * the Client-callable entry point — the same Host-owned route pattern
 * `@deepseek-ai/dsh-session-log-export` uses for `/api/session.export`.
 *
 * A Session whose stored artifacts are already gone but whose workspace entry
 * is not is handled as a ledger convergence rather than a refusal — see
 * `deleteSession`.
 *
 * @module @local/dsh-session-delete
 */
import { rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { locateSessionDir } from './paths.js';

/** Absolute pathname this Host registers the operation under. */
const SESSION_DELETE_PATH = '/api/session.delete';

/** Required services: the shared Fetch carrier that admits and routes the call. */
const inject = ['connection'];

/**
 * Session ids are branded, unvalidated strings that reach this route from the
 * page, so they are treated as untrusted input. A Session id this plugin cannot
 * recognize is refused rather than encoded.
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/**
 * The DSH home the profile composes its storages under.
 *
 * `dshHomePath` is a patch-YAML helper, not a service, so the documented
 * environment override and the default are mirrored here. The persistence root
 * is `dshHomePath('sessions')` and the projection cache lives under
 * `dshHomePath('storages')`.
 *
 * @returns the resolved DSH home directory.
 */
function dshHome() {
  const configured = process.env['DSH_HOME'];
  return configured === undefined || configured === '' ? join(homedir(), '.dsh') : configured;
}

/** A JSON response with the headers this route always sets. */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Locate every artifact this operation should remove for one Session.
 *
 * @param sessionId - the requested Session id.
 * @param cwd - the Session's stored project directory, when its header has one.
 * @returns the Session directory (or undefined) and the projection-cache file.
 */
async function locateRemovable(sessionId, cwd) {
  const sessionsRoot = join(dshHome(), 'sessions');
  const sessionDir = await locateSessionDir(sessionsRoot, cwd, sessionId);
  const projectionCacheFile = join(
    dshHome(),
    'storages',
    'session_projcache',
    'sessions',
    `${sessionId}.json`,
  );
  const projectionCacheExists = await stat(projectionCacheFile).then(() => true, () => false);
  return { sessionDir, projectionCacheFile, projectionCacheExists };
}

/**
 * Refuse a Session with a Turn still in progress.
 *
 * This is deliberately NOT a liveness check. DSH keeps a write handle open for
 * every Session it has loaded, and a loaded Session's Agent is registered for as
 * long as the browser has it open — so refusing on "an Agent exists" refuses
 * essentially every Session the user can click, which makes the feature
 * unusable. On Windows the open handle does not block removal either: Node opens
 * files with `FILE_SHARE_DELETE`, so `rm` on a loaded Session's log succeeds
 * (verified directly against this machine's live session files).
 *
 * What genuinely must not happen is deleting the log out from under a Turn that
 * is still appending to it, so the guard reads the live Session's own event tail
 * and refuses only while a Turn is open. The work is stopped by the user, whose
 * conversation is the only place with a stop control.
 *
 * A Session that is not live at all passes freely: `ctx.get('sessions')` misses,
 * and there is no log to corrupt.
 *
 * @param ctx - Host context.
 * @param sessionId - the requested Session.
 * @returns the refusal response, or undefined when no Turn is open.
 */
function openTurnRefusal(ctx, sessionId) {
  const session = ctx.get('sessions')?.get?.(sessionId);
  if (session === undefined || session === null) return undefined;
  const lastSeq = Number(session.seq) - 1;
  if (!Number.isFinite(lastSeq) || lastSeq < 0) return undefined;
  let last;
  try {
    last = session.eventAt(lastSeq) ?? session.snapshotEvents(lastSeq, lastSeq + 1)[0];
  } catch {
    return undefined;
  }
  const type = last?.type;
  // `session/end-seed` closes the inherited prefix; anything other than an
  // explicit Turn/Step closer means the Turn is still running.
  if (type === undefined || type === 'turn/end' || type === 'step/end' || type === 'session/end-seed') return undefined;
  return jsonResponse(409, {
    ok: false,
    code: 'session/busy',
    message: 'This conversation still has a Turn in progress. Stop it first, then delete.',
  });
}

/**
 * Delete one Session's stored artifacts and release its workspace accounting.
 *
 * Ordering is deliberate. The workspace ledger is released last, because that
 * write is the one the Client observes through the existing
 * `remote.workspace.follow` stream: it must not announce a removal the
 * filesystem has not accepted yet. The Session directory is removed whole — it
 * holds only this Session's own artifacts.
 *
 * The ledger is released in both cases — whether or not the stored artifacts
 * were found. A Session whose artifacts are already gone but still listed in a
 * workspace is one DSH removed out-of-band; converging the ledger there is what
 * makes the row the user is clicking disappear, instead of answering a row they
 * can see with "not found".
 *
 * @param ctx - Host context.
 * @param sessionId - the requested Session id, already shape-checked.
 * @returns the wire status and body describing what was removed.
 */
async function deleteSession(ctx, sessionId) {
  const persistence = ctx.get('sessionPersistence');
  if (persistence === undefined) {
    return {
      status: 500,
      body: { ok: false, code: 'service/unavailable', message: 'Session persistence is unavailable in this composition.' },
    };
  }

  const snapshot = await persistence.stat(sessionId);
  const cwd = snapshot?.header?.cwd;
  const { sessionDir, projectionCacheFile, projectionCacheExists } = await locateRemovable(sessionId, cwd);

  const removed = { sessionDir: sessionDir !== undefined, projectionCache: false, workspace: false };
  if (sessionDir !== undefined) await rm(sessionDir, { recursive: true, force: true });
  if (projectionCacheExists) {
    await rm(projectionCacheFile, { force: true });
    removed.projectionCache = true;
  }

  // Ledger: release it in both cases. When the stored artifacts were already
  // gone (the Session was removed out-of-band, e.g. by a previous run), the
  // ledger is the only thing still advertising it — so the row the user sees
  // corresponds to the ledger, and refusing with "not found" would tell them
  // the row they are looking at does not exist. Converging the ledger instead
  // makes that row disappear, which is what they asked for.
  const registry = ctx.get('workspaceRegistry');
  if (registry !== undefined) {
    for (const workspace of registry.list()) {
      if (!workspace.sessionIds.includes(sessionId)) continue;
      await workspace.detachSession(sessionId);
      removed.workspace = true;
      break;
    }
    // A deleted Session must not linger in the registry-global pin set. This is
    // not part of the interface contract, so a refusal is not fatal: the pin
    // set already drops ids whose Session the registry no longer finds.
    await registry.unpinSession(sessionId).catch(() => {});
  }

  // Nothing on disk AND no ledger entry: this id was never stored, or has
  // already been fully removed and pruned everywhere. Only then is 404 honest.
  if (sessionDir === undefined && !projectionCacheExists && !removed.workspace) {
    return {
      status: 404,
      body: { ok: false, code: 'session/not-found', message: 'That Session is no longer stored.' },
    };
  }

  return { status: 200, body: { ok: true, sessionId, removed } };
}

/**
 * Register the delete route.
 *
 * @param ctx - Host context carrying the shared Fetch carrier.
 */
function apply(ctx) {
  ctx.connection.fetch.register({
    path: SESSION_DELETE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return jsonResponse(400, { ok: false, code: 'request/malformed', message: 'Expected a JSON body.' });
      }
      const sessionId = payload?.sessionId;
      if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
        return jsonResponse(400, { ok: false, code: 'request/sessionId', message: 'A valid sessionId is required.' });
      }
      try {
        const refused = openTurnRefusal(ctx, sessionId);
        if (refused !== undefined) return refused;
        const { status, body } = await deleteSession(ctx, sessionId);
        return jsonResponse(status, body);
      } catch (error) {
        return jsonResponse(500, {
          ok: false,
          code: 'session/delete-failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

export { SESSION_DELETE_PATH, apply, inject };
