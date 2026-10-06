/**
 * Publish / repair GitHub Releases for this repository.
 *
 * Reads its sections from RELEASE_NOTES.md so the Release bodies cannot drift
 * from the file in the repository, and reads the token from the environment
 * (`GITHUB_TOKEN`) so it is never written to disk.
 *
 * Actions:
 *   - v1.1.0, v1.2.0 : create when absent
 *   - v1.0.0, v1.1.1 : repair — replace the body with the clean Markdown and
 *                      fix v1.1.1's leading-space title
 *   - v1.2.0         : marked as the latest release
 *
 * Usage: GITHUB_TOKEN=... node release.mjs [--dry-run]
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = 'Be201';
const REPO = 'dsh-session-delete';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const DRY = process.argv.includes('--dry-run');

const token = process.env['GITHUB_TOKEN'];
if (token === undefined || token === '') {
  console.error('GITHUB_TOKEN is not set in the environment.');
  process.exit(2);
}

/** Every tag this file documents, newest first (matches the file's order). */
const TAGS = ['v1.2.0', 'v1.1.1', 'v1.1.0', 'v1.0.0'];

/**
 * Split RELEASE_NOTES.md into `{ tag: body }`, dropping each `# vX.Y.Z` heading
 * (GitHub shows the tag as the title, so keeping it in the body would duplicate
 * it) and each leading blank line.
 *
 * @returns a map of tag -> body markdown.
 */
async function readSections() {
  const here = dirname(fileURLToPath(import.meta.url));
  const text = await readFile(join(here, 'RELEASE_NOTES.md'), 'utf8');
  const parts = text.split(/^# (v\d+\.\d+\.\d+)\s*$/m);
  // parts = ['', 'v1.2.0', '\n<body>', 'v1.1.1', '\n<body>', ...]
  const sections = new Map();
  for (let i = 1; i < parts.length; i += 2) {
    const tag = parts[i];
    const body = parts[i + 1] ?? '';
    sections.set(tag, body.replace(/^\n+/, '').replace(/\s+$/, ''));
  }
  return sections;
}

/** One authenticated JSON request. */
async function gh(method, path, payload) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dsh-session-delete-release',
      ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

const sections = await readSections();
console.log('sections parsed from RELEASE_NOTES.md:');
for (const [tag, body] of sections) {
  console.log(`  ${tag}: ${body.length} chars, first line = ${JSON.stringify(body.split('\n')[0])}`);
}
console.log('');

// 0. Token scope sanity check.
// Note: `GET /user` is NOT a valid probe for a fine-grained PAT — GitHub answers
// 404 for it whenever the token was not granted user-info scope, even when the
// token is perfectly usable on its repositories. Probe the repository instead.
const probe = await gh('GET', '');
if (!probe.ok) {
  console.error(`auth failed: GET repo -> ${probe.status} ${JSON.stringify(probe.data?.message ?? '')}`);
  process.exit(3);
}
console.log(`authenticated against ${probe.data.full_name} (private: ${probe.data.private})`);
console.log('');

let failed = 0;

for (const tag of TAGS) {
  const body = sections.get(tag);
  if (body === undefined) {
    console.log(`${tag}: FAIL - no section in RELEASE_NOTES.md`);
    failed++;
    continue;
  }
  const existing = await gh('GET', `/releases/tags/${tag}`);

  if (existing.status === 404) {
    // Create.
    const payload = {
      tag_name: tag,
      name: tag,
      body,
      draft: false,
      prerelease: false,
      ...(tag === 'v1.2.0' ? { make_latest: 'true' } : {}),
    };
    if (DRY) {
      console.log(`${tag}: DRY-RUN would CREATE (title=${JSON.stringify(tag)}, ${body.length} chars)`);
      continue;
    }
    const created = await gh('POST', '/releases', payload);
    if (created.ok) {
      console.log(`${tag}: CREATED -> ${created.data.html_url}`);
    } else {
      console.log(`${tag}: FAIL create -> ${created.status} ${JSON.stringify(created.data?.message ?? created.data)}`);
      failed++;
    }
    continue;
  }

  if (!existing.ok) {
    console.log(`${tag}: FAIL lookup -> ${existing.status} ${JSON.stringify(existing.data?.message ?? '')}`);
    failed++;
    continue;
  }

  // Repair: clean body (strip any pasted-HTML wrapper) and fix the title.
  const current = existing.data;
  const currentBody = current.body ?? '';
  const hasHtmlWrapper = currentBody.includes('<!--StartFragment-->') || currentBody.startsWith('<html>');
  const titleWrong = current.name?.trim() !== tag;
  if (!hasHtmlWrapper && !titleWrong) {
    console.log(`${tag}: OK already clean (title=${JSON.stringify(current.name)})`);
    continue;
  }
  const payload = { body, name: tag };
  if (DRY) {
    console.log(`${tag}: DRY-RUN would UPDATE (title ${JSON.stringify(current.name)} -> ${JSON.stringify(tag)}, body ${currentBody.length} -> ${body.length} chars, htmlWrapper=${hasHtmlWrapper})`);
    continue;
  }
  const updated = await gh('PATCH', `/releases/${current.id}`, payload);
  if (updated.ok) {
    console.log(`${tag}: UPDATED -> title=${JSON.stringify(updated.data.name)}, body=${body.length} chars, htmlWrapper removed=${hasHtmlWrapper}`);
  } else {
    console.log(`${tag}: FAIL update -> ${updated.status} ${JSON.stringify(updated.data?.message ?? updated.data)}`);
    failed++;
  }
}

console.log('');
if (failed > 0) {
  console.log(`${failed} operation(s) failed`);
  process.exit(1);
}
console.log(DRY ? 'dry-run complete' : 'all operations succeeded');
