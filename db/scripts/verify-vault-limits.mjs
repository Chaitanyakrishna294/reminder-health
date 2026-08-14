#!/usr/bin/env node
/**
 * Proves the Health Vault limits are enforced SERVER-SIDE, by going around the UI.
 *
 * This is the whole point of the exercise: the upload modal's checks are advice,
 * because the browser talks to Supabase Storage directly and an attacker never
 * opens the modal. So this script does not import supabase-js and does not render
 * anything — it POSTs raw bytes at the Storage REST API with a user's JWT, which
 * is exactly what an attacker with an unpacked APK would do.
 *
 * WHAT IT PROVES
 *   A. a 6 MB file is refused          (bucket file_size_limit)
 *   B. a .zip is refused               (bucket allowed_mime_types)
 *   C. the 6th file is refused         (RLS policy + vault_can_accept_upload)
 *   D. a normal upload still works, and deleting frees the slot again
 *
 * IT ONLY EVER TOUCHES ITS OWN FILES. Every object it writes lives under
 * `<uid>/_limit-probe/`, and it deletes exactly those paths — never anything it
 * did not create. Run with `--cleanup` alone if a previous run died mid-way.
 *
 * USAGE (PowerShell)
 *   $env:SUPABASE_URL       = 'https://<ref>.supabase.co'
 *   $env:SUPABASE_ANON_KEY  = '<anon key>'
 *   $env:SUPABASE_EMAIL     = 'a real test account'
 *   $env:SUPABASE_PASSWORD  = '...'
 *   node db/scripts/verify-vault-limits.mjs
 *
 * Or skip the sign-in by supplying a token you already have:
 *   $env:SUPABASE_ACCESS_TOKEN = '<user JWT>'
 *
 * USE A TEST ACCOUNT. Test C fills the account to five files. It cleans up after
 * itself, but pointing this at an account whose vault matters is a bad trade for
 * a check that takes ten seconds on a throwaway.
 *
 * Node 18+ (native fetch). No dependencies on purpose — a verification script
 * that needs an install step is one nobody runs.
 */

const URL_BASE = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const ANON = process.env.SUPABASE_ANON_KEY;
const BUCKET = 'health-vault';
const MAX_FILES = 5;
const PROBE_DIR = '_limit-probe';
const CLEANUP_ONLY = process.argv.includes('--cleanup');

if (!URL_BASE || !ANON) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  process.exit(2);
}

let pass = 0;
let fail = 0;

const ok = (name, detail) => { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, detail) => { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); };

async function signIn() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const email = process.env.SUPABASE_EMAIL;
  const password = process.env.SUPABASE_PASSWORD;
  if (!email || !password) {
    console.error('Set SUPABASE_ACCESS_TOKEN, or SUPABASE_EMAIL + SUPABASE_PASSWORD.');
    process.exit(2);
  }
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Sign-in failed (${res.status}): ${body.error_description || body.msg || JSON.stringify(body)}`);
    process.exit(2);
  }
  return body.access_token;
}

/** The `sub` claim, without pulling in a JWT library for one field. */
function uidFrom(token) {
  const payload = token.split('.')[1];
  const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json).sub;
}

const authHeaders = (token, extra = {}) => ({ apikey: ANON, Authorization: `Bearer ${token}`, ...extra });

async function upload(token, path, bytes, contentType) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': contentType, 'x-upsert': 'false' }),
    body: bytes,
  });
  let detail = '';
  try { detail = JSON.stringify(await res.json()); } catch { /* empty body */ }
  return { status: res.status, detail };
}

async function remove(token, path) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  return res.status;
}

/** Counts through the RPC, which is also a check that `authenticated` may call it. */
async function countViaRpc(token) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/vault_object_count`, {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: '{}',
  });
  if (!res.ok) return { error: `${res.status} ${await res.text()}` };
  return { count: await res.json() };
}

/** A tiny but real PNG, so the mime check has something legitimate to accept. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function cleanup(token, uid, paths) {
  for (const p of paths) await remove(token, p);
  // Belt and braces: list anything left under the probe folder and remove it too,
  // so a run that died between upload and delete does not leak a slot.
  const res = await fetch(`${URL_BASE}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix: `${uid}/${PROBE_DIR}`, limit: 100 }),
  });
  if (!res.ok) return;
  const items = await res.json();
  for (const item of items) {
    if (item?.name) await remove(token, `${uid}/${PROBE_DIR}/${item.name}`);
  }
}

(async () => {
  const token = await signIn();
  const uid = uidFrom(token);
  const p = (n) => `${uid}/${PROBE_DIR}/${n}`;
  const created = [];

  console.log(`\nHealth Vault limits — direct Storage API, no UI involved`);
  console.log(`user ${uid}\n`);

  if (CLEANUP_ONLY) {
    await cleanup(token, uid, []);
    console.log('Probe folder cleaned. Nothing else touched.');
    return;
  }

  try {
    const before = await countViaRpc(token);
    if (before.error) bad('vault_object_count is callable by authenticated', before.error);
    else ok('vault_object_count is callable by authenticated', `holds ${before.count} file(s)`);

    // ── A. oversized ────────────────────────────────────────────────────────
    // 6 MB of zeros, declared as a PNG so nothing but the SIZE can be the reason
    // it is refused.
    {
      const big = Buffer.alloc(6 * 1024 * 1024);
      const r = await upload(token, p('oversize.png'), big, 'image/png');
      if (r.status === 200) { created.push(p('oversize.png')); bad('A: 6 MB file refused', 'it was ACCEPTED'); }
      else ok('A: 6 MB file refused', `HTTP ${r.status} ${r.detail}`);
    }

    // ── B. disallowed type ──────────────────────────────────────────────────
    // Small, so size cannot be the reason — only the mime list can.
    {
      const r = await upload(token, p('archive.zip'), Buffer.from('PK not really'), 'application/zip');
      if (r.status === 200) { created.push(p('archive.zip')); bad('B: .zip refused', 'it was ACCEPTED'); }
      else ok('B: .zip refused', `HTTP ${r.status} ${r.detail}`);
    }

    // ── C. the 6th file ─────────────────────────────────────────────────────
    const existing = (await countViaRpc(token)).count ?? 0;
    const toAdd = Math.max(0, MAX_FILES - existing);
    let filledOk = true;
    for (let i = 0; i < toAdd; i++) {
      const path = p(`fill-${i}.png`);
      const r = await upload(token, path, PNG_1PX, 'image/png');
      if (r.status === 200) created.push(path);
      else { filledOk = false; bad(`C: filling to ${MAX_FILES}`, `upload ${i + 1} failed: HTTP ${r.status} ${r.detail}`); break; }
    }
    if (filledOk) {
      const now = (await countViaRpc(token)).count;
      if (now !== MAX_FILES) bad(`C: account sits at exactly ${MAX_FILES}`, `count is ${now}`);
      else {
        ok(`C: account filled to ${MAX_FILES}`, `count = ${now}`);
        const r = await upload(token, p('sixth.png'), PNG_1PX, 'image/png');
        if (r.status === 200) { created.push(p('sixth.png')); bad('C: 6th file refused', 'it was ACCEPTED'); }
        else ok('C: 6th file refused', `HTTP ${r.status} ${r.detail}`);
      }
    }

    // ── D. deleting frees the slot ──────────────────────────────────────────
    if (created.length > 0) {
      const victim = created.pop();
      const status = await remove(token, victim);
      if (status !== 200) bad('D: delete succeeds', `HTTP ${status}`);
      else {
        const r = await upload(token, p('after-delete.png'), PNG_1PX, 'image/png');
        if (r.status === 200) { created.push(p('after-delete.png')); ok('D: deleting frees the slot', 'upload accepted again'); }
        else bad('D: deleting frees the slot', `still refused: HTTP ${r.status} ${r.detail}`);
      }
    }
  } finally {
    await cleanup(token, uid, created);
    console.log('\nProbe files removed.');
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
