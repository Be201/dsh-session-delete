# Third-party notices

## DeepSeek Harness (`@deepseek-ai/dsh-*`)

MIT License — Copyright (c) 2026 DeepSeek

Portions of this project are adapted from the DeepSeek Harness client UI:

- `client.js` — the menu-row, modal and keycap stylesheet values are derived from
  `@deepseek-ai/dsh-client-ui-primitives`: row geometry and the destructive-row
  colours from `Menu.module.css`, the mask/card/header/footer rules from
  `Modal.module.css`, the button surface from `Button.module.css`, and the
  shortcut keycap specs (`ShortcutKeys.module.css` plus the menu row's
  `.shortcut` / `.shortcutKeys` rules: `--dsw-alias-label-caption`, 11px/16px,
  `margin-inline-start: auto`). The archive-confirm dialog in
  `@deepseek-ai/dsh-client-ui-workspace` is the reference for the dialog layout,
  and the trash glyph path data is the `IconTrashOutlineRegular` artwork. All
  derived class names are renamed under the `dsd_` prefix and only `--dsw-*` /
  `--dsh-*` token references are retained, as the Harness plugin guidelines
  require.
- `index.js`, `paths.js` — the two path encoders in `paths.js`
  (`encodeSegment`, `projectKey`) reproduce the storage layout documented by
  `@deepseek-ai/dsh-session-persistence-jsonl`, which publishes no path helper.
- `cordis.patch.yml`, `package.json` — the bundle manifest and Loader patch
  shape follow the vendor templates shipped in
  `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development`.

No Harness source files are redistributed here; only the above values and shapes
were re-implemented.
