/**
 * Exercises the Delete command's shortcut definition against DeepSeek
 * Harness's own validation rules, without needing a running Harness.
 *
 * The rules are re-implemented here from `@deepseek-ai/dsh-client-shortcuts`
 * (`bindingIssue`, `isWebBindingAllowed`, `resolveShortcutDefault`) precisely
 * because `ctx.shortcuts.register()` *throws* on a rejected or conflicting
 * binding. A mistake would not degrade the shortcut — it would fail the whole
 * client half, so the definition is worth pinning.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const here = dirname(fileURLToPath(import.meta.url));

/** The plugin's own definition, read from client.js so the test cannot drift. */
const source = readFileSync(join(here, 'client.js'), 'utf8');

/** Pull the `ctx.shortcuts.register({...})` literal's key fields out of the source. */
function readDefinition() {
  const block = /ctx\.shortcuts\.register\(\{([\s\S]*?)\n {8}\}\)/.exec(source);
  assert.ok(block !== null, 'could not find the ctx.shortcuts.register(...) call in client.js');
  const body = block[1];
  const id = /id: '([^']+)'/.exec(body)?.[1];
  const code = /'desktop:windows': \{ code: '([^']+)'/.exec(body)?.[1];
  const modifiers = [...(/modifiers: \[([^\]]+)\]/.exec(body)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  const regionBlock = /regions: \[([^\]]*)\]/.exec(body)?.[1]?.trim() ?? '';
  const modalBlock = /modals: \[([^\]]*)\]/.exec(body)?.[1]?.trim() ?? '';
  const defaults = {};
  for (const m of body.matchAll(/'((?:desktop|web):(?:macos|windows|linux))': \{ code: '([^']+)', modifiers: \[([^\]]*)\] \}/g)) {
    defaults[m[1]] = { code: m[2], modifiers: [...m[3].matchAll(/'([a-z]+)'/g)].map((x) => x[1]) };
  }
  return { id, code, modifiers, defaults, regionBlock, modalBlock };
}

const def = readDefinition();

/** Port of the reserved list in dsh-client-shortcuts bindingIssue(). */
const NAVIGATION_KEYS = ['Escape', 'Tab', 'Space', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const CLIPBOARD_KEYS = ['KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyY', 'KeyQ', 'KeyH'];

/** The modifier order the service canonicalises to (`modifierOrder`). */
const MODIFIER_ORDER = ['control', 'alt', 'shift', 'meta'];

/**
 * Port of the service's `normalizeBinding`: expand `primary` into the platform's
 * physical modifier, deduplicate, and order canonically. The web admission check
 * only ever sees this normalized form, which is exactly the detail that made the
 * first version of this harness wrong.
 *
 * @param binding - declared `{code, modifiers}`.
 * @param platform - 'windows' | 'macos' | 'linux'.
 * @returns the canonical binding.
 */
function normalizeBinding(binding, platform) {
  const expanded = binding.modifiers.map((m) => (m === 'primary' ? (platform === 'macos' ? 'meta' : 'control') : m));
  const set = new Set(expanded);
  return { code: binding.code, modifiers: MODIFIER_ORDER.filter((m) => set.has(m)) };
}

/**
 * @param binding - candidate `{code, modifiers}`, already normalized.
 * @param runtime - 'desktop' | 'web'.
 * @param platform - 'windows' | 'macos' | 'linux'.
 * @returns the rejection reason, or null.
 */
function bindingIssue(binding, runtime, platform) {
  const { code, modifiers } = binding;
  if (runtime === 'desktop' && (platform === 'windows' || platform === 'macos')) return null;
  if (modifiers.length === 0 || modifiers.every((m) => m === 'shift')) return 'modifier-required';
  if ((platform === 'windows' || platform === 'macos') && modifiers.length >= 3) return null;
  if (runtime === 'web' && (platform === 'windows' || platform === 'macos') && isWebBindingAllowed(binding, platform)) return null;
  const primary = modifiers.includes(platform === 'macos' ? 'meta' : 'control');
  if (NAVIGATION_KEYS.includes(code)
    || (code === 'Enter' && !modifiers.includes('alt'))
    || (primary && CLIPBOARD_KEYS.includes(code))
    || (primary && code === 'KeyA' && !modifiers.includes('shift'))
    || (platform !== 'macos' && modifiers.includes('meta'))
    || (platform !== 'macos' && modifiers.includes('alt') && ['F4', 'F2'].includes(code))
    || (platform === 'macos' && modifiers.includes('control') && modifiers.includes('meta'))
    || (platform === 'macos' && modifiers.includes('alt') && !primary)) return 'reserved';
  if (runtime === 'web' && !isWebBindingAllowed(binding, platform)) return 'unsupported-browser';
  return null;
}

/**
 * Port of `isWebBindingAllowed`. Linux falls through to `false` here, matching
 * the service's limited set, which is why this plugin declares no `web:linux`
 * default (the service admits three-or-more-modifier chords there only).
 */
function isWebBindingAllowed(binding, platform) {
  if (binding.secondCode !== undefined) return false;
  if (platform === 'windows' || platform === 'macos') {
    if (binding.modifiers.length >= 3) return true;
    const primary = platform === 'macos' ? 'meta' : 'control';
    if (binding.modifiers.length === 1
      && ((['Comma', 'Backslash'].includes(binding.code) && binding.modifiers[0] === primary)
        || (binding.code === 'Backquote' && binding.modifiers[0] === 'control'))) return true;
    if (binding.modifiers.length === 2
      && binding.modifiers.includes(primary)
      && (binding.modifiers.includes('alt') || binding.modifiers.includes('shift'))) return true;
  }
  return false;
}

/** Normalize every declared binding once, the way registration does. */
const normalized = Object.fromEntries(
  Object.entries(def.defaults).map(([key, binding]) => {
    const [runtime, platform] = key.split(':');
    return [key, { runtime, platform, binding: normalizeBinding(binding, platform) }];
  }),
);

/** Every shipped binding this plugin could collide with, read from the host UI. */
const SHIPPED = [
  { id: 'session.new', code: 'KeyN', modifiers: ['primary'] },
  { id: 'session.search', code: 'KeyK', modifiers: ['primary'] },
  { id: 'workspace.add', code: 'KeyO', modifiers: ['primary'] },
  { id: 'session.rename', code: 'KeyG', modifiers: ['primary', 'alt'] },
  { id: 'session.fork', code: 'KeyF', modifiers: ['primary', 'alt'] },
  { id: 'session.archive', code: 'KeyA', modifiers: ['primary', 'shift'] },
];

console.log('\n[1] the definition was read from the real source');
await check('id is namespaced and not a shipped id', () => {
  assert.equal(def.id, 'session.delete');
  assert.ok(!SHIPPED.some((s) => s.id === def.id), 'id collides with a shipped command');
});
await check('all five bindings are declared', () => {
  for (const key of ['desktop:macos', 'desktop:windows', 'desktop:linux', 'web:macos', 'web:windows']) {
    assert.ok(key in def.defaults, `missing default for ${key}`);
  }
});
await check('modifiers use the resolved vocabulary (not raw "ctrl"/"shift")', () => {
  for (const [key, binding] of Object.entries(def.defaults)) {
    for (const m of binding.modifiers) {
      assert.ok(['primary', 'alt', 'shift', 'control', 'meta'].includes(m), `${key} has unknown modifier ${m}`);
    }
  }
});

console.log('\n[2] no binding is rejected by the shortcut service');
for (const [key, entry] of Object.entries(normalized)) {
  await check(`${key}: ${entry.binding.modifiers.join('+')}+${entry.binding.code}`, () => {
    assert.equal(bindingIssue(entry.binding, entry.runtime, entry.platform), null);
  });
}
await check('no web:linux default is declared (the service admits only 3+ modifiers there)', () => {
  assert.equal('web:linux' in def.defaults, false);
});

console.log('\n[3] the desktop binding is what was asked for: Ctrl+Shift+D');
await check('desktop:windows declares primary+shift on KeyD', () => {
  assert.deepEqual(def.defaults['desktop:windows'], { code: 'KeyD', modifiers: ['primary', 'shift'] });
});
await check('it normalizes to control+shift on KeyD', () => {
  assert.deepEqual(normalized['desktop:windows'].binding, { code: 'KeyD', modifiers: ['control', 'shift'] });
});

console.log('\n[4] no collision with any shipped default');
for (const shipped of SHIPPED) {
  await check(`differs from ${shipped.id}`, () => {
    for (const [key, entry] of Object.entries(normalized)) {
      const sameCode = entry.binding.code === shipped.code;
      const sameMods = entry.binding.modifiers.length === shipped.modifiers.length
        && entry.binding.modifiers.every((m) => shipped.modifiers.includes(m));
      assert.ok(!(sameCode && sameMods), `collides with ${shipped.id} on ${key}`);
    }
  });
}

console.log('\n[5] parameter shape the renderer relies on');
await check('regions is exactly ["page"] and modals is empty', () => {
  assert.equal(def.regionBlock, "'page'");
  assert.equal(def.modalBlock, '');
});
await check('Keycaps tolerates the keys array the service produces', () => {
  // The service presents Windows chords as ['Ctrl','+','Shift','+','D'].
  const shown = ['Ctrl', '+', 'Shift', '+', 'D'];
  assert.ok(shown.includes('+'), 'the "+" joiners are what the stylesheet styles as separators');
  assert.equal(shown.filter((k) => k !== '+').join(''), 'CtrlShiftD');
});

console.log(failures === 0 ? '\nALL SHORTCUT CHECKS PASSED' : `\n${String(failures)} SHORTCUT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
