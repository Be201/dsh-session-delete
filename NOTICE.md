# Third-party notices

## DeepSeek Harness (`@deepseek-ai/dsh-*`)

MIT License — Copyright (c) 2026 DeepSeek

Portions of this project are adapted from the DeepSeek Harness client UI:

- `client.js` — the menu-row and modal stylesheet values (row geometry, the
  modal mask/card/header/footer rules, the destructive-row colours) are derived
  from `@deepseek-ai/dsh-client-ui-primitives`' `Menu.module.css`,
  `Modal.module.css` and `Button.module.css`, and from the archive-confirm
  dialog in `@deepseek-ai/dsh-client-ui-workspace`. The trash glyph path data is
  the `IconTrashOutlineRegular` artwork. All derived class names are renamed
  under the `dsd_` prefix and only `--dsw-*` / `--dsh-*` token references are
  retained, as the Harness plugin guidelines require.
- `index.js`, `paths.js` — the two path encoders in `paths.js`
  (`encodeSegment`, `projectKey`) reproduce the storage layout documented by
  `@deepseek-ai/dsh-session-persistence-jsonl`, which publishes no path helper.
- `cordis.patch.yml`, `package.json` — the bundle manifest and Loader patch
  shape follow the vendor templates shipped in
  `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development`.

No Harness source files are redistributed here; only the above values and shapes
were re-implemented.
