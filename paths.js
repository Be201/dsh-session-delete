/**
 * Path derivation for the Delete Session bundle.
 *
 * DSH's `session-persistence-jsonl` backend stores one Session per
 * `<projectKey>/<encodeSegment(id)>` directory under the persistence root, but
 * exports no path helper: its public face is `ctx.sessionPersistence` handles
 * only. Locating a Session therefore means reproducing the two encoders below.
 *
 * They are kept in their own module so they can be checked directly against a
 * real `~/.dsh/sessions` tree, and they are used only to build the name the
 * lookup searches for — never to delete a computed path. {@link locateSessionDir}
 * verifies the candidate exists before anything removes it, so a future change
 * to either encoding degrades into "not found" rather than a wrong deletion.
 *
 * @module @local/dsh-session-delete/paths
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Encode one string as a single injective path segment.
 *
 * Mirrors the backend's escape: safe code units stay literal, every other unit
 * (including `~` itself) becomes `~XXXX`. Operating on code units preserves lone
 * surrogates, while special-casing `.` and `..` prevents traversal by an
 * otherwise safe whole segment.
 *
 * @param raw - the string to encode; must be non-empty.
 * @returns the escaped single path segment.
 */
export function encodeSegment(raw) {
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}

/**
 * Build the readable directory key for one project path.
 *
 * Mirrors the backend's project key: filesystem and drive separators collapse
 * into `-`, unsafe code units use the same `~XXXX` escape as a Session id, and
 * the result is bounded for filesystem component limits. Separator collapsing
 * and truncation are intentionally lossy, following the human-navigable
 * convention the backend documents.
 *
 * @param cwd - the Session's project directory.
 * @returns a single filesystem-safe project directory name.
 */
export function projectKey(cwd) {
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

/**
 * The project directory a Session's header points at.
 *
 * @param sessionsRoot - the persistence root.
 * @param cwd - the Session's stored project directory.
 * @returns the project directory path; the root's `_no-cwd` seat when the
 * header carries no `cwd`.
 */
export function projectDir(sessionsRoot, cwd) {
  return cwd === undefined ? join(sessionsRoot, '_no-cwd') : join(sessionsRoot, projectKey(cwd));
}

/** Whether a path exists and is a directory. */
export async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Whether a path exists at all. */
export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the one Session directory that owns `sessionId`.
 *
 * The project directory derived from the stored `cwd` is checked first, so the
 * ordinary case is a single `stat`. When that misses — the Session's project
 * directory was renamed or removed after the log was written, or the header
 * carries no `cwd` — the root is searched one level deep. That fallback is sound
 * because `encodeSegment` is injective, so at most one project directory can
 * hold a Session with this id.
 *
 * @param sessionsRoot - the persistence root.
 * @param cwd - the Session's stored project directory, when its header has one.
 * @param sessionId - the raw Session id.
 * @returns the existing Session directory, or undefined when there is none.
 */
export async function locateSessionDir(sessionsRoot, cwd, sessionId) {
  const segment = encodeSegment(sessionId);
  const direct = join(projectDir(sessionsRoot, cwd), segment);
  if (await isDirectory(direct)) return direct;
  let entries;
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(sessionsRoot, entry.name, segment);
    if (await isDirectory(candidate)) return candidate;
  }
  return undefined;
}
