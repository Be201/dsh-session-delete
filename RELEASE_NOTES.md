# v1.2.0

## Fixed

**A stale ledger row now converges instead of answering 404.**

A Session could appear in the sidebar with no stored artifacts behind it — the
log directory and projection cache were already removed out-of-band, but the
workspace ledger still listed it. Clicking delete on that row returned:

```
删除失败：That Session is no longer stored.
```

which contradicted what the user was looking at: the row *was* right there.

The Host now releases the ledger entry in both cases — whether or not the stored
artifacts were found — and only reports 404 when the Session exists nowhere at
all (no log, no cache, no ledger entry). A Session that is completely unknown
still gets an honest "not found"; a Session that is only *half* gone gets the
half that remains cleaned up.

This surfaced as an "ungrouped sessions cannot be deleted" report: the ungrouped
rows were exactly the out-of-band-removed ones, so the correlation was real but
the cause was ledger divergence, not grouping.

# v1.1.1

Aligns the shortcut keycaps with the shipped menu rows. No behaviour change.

## Fixed

The keycaps shown at the end of the **Delete conversation** row were styled from
an estimate. They now use the menu's own specification, so they match the
keycaps the shipped rows draw:

| | before | now (matches `Menu.module.css`) |
|---|---|---|
| Colour | `--dsw-alias-label-tertiary` | `--dsw-alias-label-caption` |
| Size | 12px / 16px | **11px / 16px** |
| Alignment | `flex: 1` label + `flex: none` keys | plus `margin-inline-start: auto` |

The `<kbd>` run keeps `ShortcutKeys.module.css`'s rules verbatim
(`inline-flex`, `gap: 3px`, `font: inherit`), with the `+` separators rendered
as the same `font: inherit` joins the primitive uses.

# v1.1.0

Adds a keyboard shortcut for the delete confirmation. Everything else is
unchanged from [v1.0.0](https://github.com/Be201/dsh-session-delete/releases/tag/v1.0.0).

## Shortcut

| Shell | Default |
|---|---|
| Desktop (Windows / Linux / macOS) | `Ctrl+Shift+D` (`Cmd+Shift+D` on macOS) |
| Web (Windows / macOS) | `Ctrl+Shift+D` (`Cmd+Shift+D` on macOS) |

The menu row shows the keycaps the active profile actually resolved, so the
binding is discoverable without opening settings.

- **The shortcut only opens the confirmation dialog.** It never deletes
  directly — a permanent operation should not be one accidental chord away.
- The target is the Session the main Conversation is showing, resolved the same
  way the shipped *Archive session* command resolves it.
- With no conversation open the chord reports "open a conversation first"
  instead of failing silently.
- It fires only in the `page` region (typing in an input cannot trigger it) and
  never while a modal is open.
- Rebind it through DSH's own shortcut settings (`session.delete`); the plugin
  only supplies defaults.

`KeyD` is free of the shortcut service's reserved set and of every shipped
default, so registration cannot collide — which matters, because
`ctx.shortcuts.register()` **throws** on a rejected or conflicting binding
rather than degrading. `check-shortcut.mjs` pins that by re-running DSH's own
validation and conflict rules against the declared definition.

## What a deletion removes

| Target | Path |
|---|---|
| Session log directory | `~/.dsh/sessions/<project>/<session-id>/` |
| Projection cache | `~/.dsh/storages/session_projcache/sessions/<session-id>.json` |
| Workspace accounting | the Session's entry in `~/.dsh/storages/workspace.json` |

**This is not recoverable.** Use *Archive session* instead when a Session should
be kept.

## Behaviour

- **Refused while a Turn is in progress** (409 `session/busy`), so the log is
  never pulled out from under a Turn that is still appending to it.
- **Not a liveness check.** An earlier revision refused whenever the Session had
  a live Agent, which refused essentially every row a user could click: DSH keeps
  an Agent and an open write handle for every *loaded* Session. It also protected
  nothing — Node opens files with `FILE_SHARE_DELETE` on Windows, so `rm` on a
  loaded Session's log succeeds (verified against live session files).
- **Session ids are treated as untrusted page input.** They are shape-checked,
  then encoded to a single path segment; `../`, separators, NUL and over-long
  input are rejected or escaped.
- **Only existing directories are removed.** `locateSessionDir` stats the
  candidate before anything removes it, so a future change to DSH's directory
  naming degrades to "not found" rather than a wrong deletion.
- **The route is authenticated.** `/api/session.delete` is registered on the
  shared Fetch carrier via `ctx.connection`, using the same Host/Origin checks
  and browser authentication as the built-in `/api/session.export`;
  unauthenticated requests get 401 and never reach the handler.
- **Failures are not reported as successes.** The post-delete list refresh is
  best-effort, so a completed deletion is never displayed as failed.

## Install

This is a DSH **bundle**: `package.json` declares `dsh.bundle.patch` and
`cordis.patch.yml` inserts one plugin row. Install it with the plugin manager —
do not hand-edit the profile's `package.json` / `cordis.patch.yml`, and do not
run pnpm in the profile yourself.

1. Put this repository anywhere on disk, e.g. `~/src/dsh-session-delete`.
2. Have the agent call `plugin_manager` with `action: install_bundle` and the
   **absolute path** to that directory as `target`.
3. Or use the CLI: `dsh plugin --profile <profile> install <absolute-path>`.

Uninstall with `plugin_manager` `remove_bundle`, target
`@local/dsh-session-delete`. **Uninstall before deleting the directory** —
otherwise a junction and a bundle dependency are left pointing at a path that no
longer exists.

## Verified against

Windows + DeepSeek Harness `0.2.0-rc.2`, `desktop` profile. Node.js 22+.

## Checks

```
node check-paths.mjs       # path derivation
node check-shortcut.mjs    # shortcut definition vs DSH's own validation rules
node check-route.mjs       # Host route contract
node check-regression.mjs  # live Session with an open log handle
node audit-cleanup.mjs <sessionId>   # read-only post-delete audit
```

All five run without a DSH installation and pass against an empty `DSH_HOME`.

## Known limitations

- **Attachments are not deleted.** Session images are content-addressed under
  `~/.dsh/attachments/`, and one object can be referenced by several Sessions, so
  removing them per-Session would destroy other Sessions' images. Deleting a
  Session with images therefore does not reclaim that space.
- **Deleting a Session DSH still has loaded** means a later write to that Session
  will fail. That is inherent to permanently deleting a conversation in use.
- **`DSH_HOME` is trusted.** A wrong value redirects the deletion to another
  directory tree (a matching Session directory is still required).
- **Runs with Host process privileges**, as every DSH plugin does.

## Licence

MIT. Portions of the client UI are adapted from DeepSeek Harness (MIT,
Copyright (c) 2026 DeepSeek) — see
[NOTICE.md](https://github.com/Be201/dsh-session-delete/blob/main/NOTICE.md).


# v1.0.0

Adds a **Delete conversation** row directly below **Archive session** in every
Session's `⋯` menu, with a confirmation dialog that permanently removes the
Session.

DSH has no session-deletion API at all: `sessionPersistence` is append-only, and
its own contract states that logs accumulate under the persistence root "until an
external actor removes them — the seam has no delete interface". This bundle is
that actor.

## What a deletion removes

| Target | Path |
|---|---|
| Session log directory | `~/.dsh/sessions/<project>/<session-id>/` |
| Projection cache | `~/.dsh/storages/session_projcache/sessions/<session-id>.json` |
| Workspace accounting | the Session's entry in `~/.dsh/storages/workspace.json` |

**This is not recoverable.** Use *Archive session* instead when a Session should
be kept.

## Behaviour

- **Refused while a Turn is in progress** (409 `session/busy`), so the log is
  never pulled out from under a Turn that is still appending to it.
- **Not a liveness check.** An earlier revision refused whenever the Session had
  a live Agent, which refused essentially every row a user could click: DSH keeps
  an Agent and an open write handle for every *loaded* Session. It also protected
  nothing — Node opens files with `FILE_SHARE_DELETE` on Windows, so `rm` on a
  loaded Session's log succeeds (verified against live session files).
- **Session ids are treated as untrusted page input.** They are shape-checked,
  then encoded to a single path segment; `../`, separators, NUL and over-long
  input are rejected or escaped.
- **Only existing directories are removed.** `locateSessionDir` stats the
  candidate before anything removes it, so a future change to DSH's directory
  naming degrades to "not found" rather than a wrong deletion.
- **The route is authenticated.** `/api/session.delete` is registered on the
  shared Fetch carrier via `ctx.connection`, using the same Host/Origin checks
  and browser authentication as the built-in `/api/session.export`;
  unauthenticated requests get 401 and never reach the handler.
- **Failures are not reported as successes.** The post-delete list refresh is
  best-effort, so a completed deletion is never displayed as failed.

## Install

This is a DSH **bundle**: `package.json` declares `dsh.bundle.patch` and
`cordis.patch.yml` inserts one plugin row. Install it with the plugin manager —
do not hand-edit the profile's `package.json` / `cordis.patch.yml`, and do not
run pnpm in the profile yourself.

1. Put this repository anywhere on disk, e.g. `~/src/dsh-session-delete`.
2. Have the agent call `plugin_manager` with `action: install_bundle` and the
   **absolute path** to that directory as `target`.
3. Or use the CLI: `dsh plugin --profile <profile> install <absolute-path>`.

Uninstall with `plugin_manager` `remove_bundle`, target
`@local/dsh-session-delete`. **Uninstall before deleting the directory** —
otherwise a junction and a bundle dependency are left pointing at a path that no
longer exists.

## Verified against

Windows + DeepSeek Harness `0.2.0-rc.2`, `desktop` profile. Node.js 22+.

## Checks

```
node check-paths.mjs       # path derivation
node check-route.mjs       # Host route contract
node check-regression.mjs  # live Session with an open log handle
node audit-cleanup.mjs <sessionId>   # read-only post-delete audit
```

All four run without a DSH installation and pass against an empty `DSH_HOME`.

## Known limitations

- **Attachments are not deleted.** Session images are content-addressed under
  `~/.dsh/attachments/`, and one object can be referenced by several Sessions, so
  removing them per-Session would destroy other Sessions' images. Deleting a
  Session with images therefore does not reclaim that space.
- **Deleting a Session DSH still has loaded** means a later write to that Session
  will fail. That is inherent to permanently deleting a conversation in use.
- **`DSH_HOME` is trusted.** A wrong value redirects the deletion to another
  directory tree (a matching Session directory is still required).
- **Runs with Host process privileges**, as every DSH plugin does.

## Licence

MIT. Portions of the client UI are adapted from DeepSeek Harness (MIT,
Copyright (c) 2026 DeepSeek) — see
[NOTICE.md](https://github.com/Be201/dsh-session-delete/blob/main/NOTICE.md).
