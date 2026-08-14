#!/usr/bin/env node
/**
 * Find — and only on explicit confirmation, delete — storage objects whose owning
 * account no longer exists.
 *
 * WHY THIS IS A RECURRING CHORE, NOT A ONE-OFF
 * ============================================
 * `storage.objects.owner` is a foreign key to `auth.users` with ON DELETE SET
 * NULL. So every account deletion silently converts that account's remaining
 * files into objects that no RLS policy can ever match again: not SELECT, not
 * DELETE. Nobody can list them, nobody can remove them through the app, they
 * count toward nobody's quota, and they are billed forever.
 *
 * `delete_my_account` (APPLIED.md #61) cannot clean them up: Supabase blocks
 * `DELETE FROM storage.objects` outright — that is the exact 42501 that once
 * broke all in-app account deletion. Storage bytes can only be removed through
 * the Storage API, which means a service_role script. This is that script, and
 * it is the companion to `delete_my_account` rather than a one-time fix: run it
 * after a batch of deletions, or on a schedule.
 *
 * The 2026-08-13 vault-limits validation counted 114 such objects in
 * `health-vault` alone.
 *
 * HOW "ORPHAN" IS DECIDED — and why not `owner IS NULL`
 * ----------------------------------------------------
 * The obvious test is the wrong one for half the buckets. `avatars` policies key
 * on `(storage.foldername(name))[1] = auth.uid()::text`, NOT on `owner`, so an
 * avatar with a NULL owner is still perfectly reachable by its user. A test that
 * deleted on `owner IS NULL` would take live users' profile photos.
 *
 * So this script asks the question that actually matters, and asks it the same
 * way for every bucket: **does the account named by the first path segment still
 * exist?** Both buckets store under `<uid>/…`, so that segment is the owner, and
 * a uid absent from `auth.users` means the account is gone.
 *
 * Anything it cannot classify with certainty is reported and SKIPPED:
 *   - a first segment that is not a UUID (pre-convention or hand-uploaded);
 *   - a `health-vault` object still referenced by a `health_records` row, which
 *     means something can still reach it — a caregiver, or a row whose cascade
 *     did not fire. Reported loudly, because it should be impossible.
 *
 * SAFETY
 * ------
 *   - Dry run is the DEFAULT. Deleting takes `--delete --confirm DELETE`.
 *   - It refuses to delete more than --max objects (default 500) in one run, so
 *     a bad classification cannot empty a bucket before anyone notices.
 *   - It never deletes anything it did not classify as ORPHAN.
 *   - It prints the full list before it deletes anything.
 *
 * USAGE (PowerShell)
 *   $env:SUPABASE_URL              = 'https://<ref>.supabase.co'
 *   $env:SUPABASE_SERVICE_ROLE_KEY = '<service_role key>'
 *
 *   node db/scripts/purge-orphan-storage.mjs                     # dry run, both buckets
 *   node db/scripts/purge-orphan-storage.mjs --bucket health-vault
 *   node db/scripts/purge-orphan-storage.mjs --json > orphans.json
 *   node db/scripts/purge-orphan-storage.mjs --delete --confirm DELETE
 *
 * THE SERVICE_ROLE KEY BYPASSES RLS ENTIRELY. Never put it in a shell profile,
 * never paste it into a file in this repo, and close the terminal afterwards.
 *
 * Node 18+ (native fetch). No dependencies, so there is no install step between
 * noticing the problem and fixing it.
 */

const URL_BASE = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};

const DO_DELETE = flag('delete');
const CONFIRMED = value('confirm', '') === 'DELETE';
const AS_JSON = flag('json');
const MAX_DELETE = Number(value('max', '500'));
const ONLY_BUCKET = value('bucket', null);

const ALL_BUCKETS = ['health-vault', 'avatars'];
const BUCKETS = ONLY_BUCKET ? [ONLY_BUCKET] : ALL_BUCKETS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!URL_BASE || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}
if (ONLY_BUCKET && !ALL_BUCKETS.includes(ONLY_BUCKET)) {
  console.error(`Unknown bucket "${ONLY_BUCKET}". Known: ${ALL_BUCKETS.join(', ')}`);
  process.exit(2);
}

const headers = (extra = {}) => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  ...extra,
});

// Written to stderr so `--json > file` stays machine-readable.
const log = (...a) => { if (!AS_JSON) console.log(...a); else console.error(...a); };

/** Every live account id. One Set, so the per-object check is free. */
async function liveUserIds() {
  const ids = new Set();
  for (let page = 1; ; page++) {
    const res = await fetch(`${URL_BASE}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: headers(),
    });
    if (!res.ok) {
      console.error(`Could not list users (${res.status}): ${await res.text()}`);
      console.error('Without the full user list every object would look orphaned. Refusing to continue.');
      process.exit(2);
    }
    const body = await res.json();
    const users = body.users ?? [];
    users.forEach((u) => ids.add(u.id));
    if (users.length < 200) break;
  }
  return ids;
}

/**
 * Every object in a bucket, walked depth-first.
 *
 * The list endpoint is one level at a time: entries with a null `id` are folders,
 * not files. health-vault nests two deep (`<uid>/<categoryId>/<file>`) and
 * avatars one, so this recurses rather than assuming either shape.
 */
async function listAll(bucket, prefix = '', out = []) {
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${URL_BASE}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${bucket}/${prefix} failed (${res.status}): ${await res.text()}`);
    const items = await res.json();
    for (const item of items) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) await listAll(bucket, path, out);
      else out.push({ path, size: Number(item.metadata?.size ?? 0) });
    }
    if (items.length < 1000) break;
  }
  return out;
}

/**
 * Which of these paths a `health_records` row still points at.
 *
 * A hit means something can still reach the object — a caregiver read policy
 * joins on exactly this — so it is not an orphan no matter what the account
 * table says. Chunked because the filter goes in a URL.
 */
async function referencedPaths(paths) {
  const found = new Set();
  for (let i = 0; i < paths.length; i += 50) {
    const chunk = paths.slice(i, i + 50);
    const list = chunk.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(',');
    const res = await fetch(
      `${URL_BASE}/rest/v1/health_records?select=file_url&file_url=in.(${encodeURIComponent(list)})`,
      { headers: headers() },
    );
    if (!res.ok) {
      console.error(`Could not check health_records (${res.status}): ${await res.text()}`);
      console.error('Refusing to continue — an unchecked object could be one a caregiver can still open.');
      process.exit(2);
    }
    (await res.json()).forEach((r) => found.add(r.file_url));
  }
  return found;
}

async function removeBatch(bucket, paths) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) throw new Error(`delete failed (${res.status}): ${await res.text()}`);
  return (await res.json()).length;
}

const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

(async () => {
  log(`\nOrphan storage scan — ${URL_BASE}`);
  log(DO_DELETE && CONFIRMED ? 'MODE: DELETE' : 'MODE: dry run (nothing will be removed)');

  const live = await liveUserIds();
  log(`${live.size} live account(s)\n`);

  const report = { scannedAt: new Date().toISOString(), buckets: {}, deleted: 0 };
  const toDelete = [];

  for (const bucket of BUCKETS) {
    const objects = await listAll(bucket);
    const orphans = [];
    const unknown = [];
    let liveCount = 0;

    for (const obj of objects) {
      const first = obj.path.split('/')[0];
      if (!UUID_RE.test(first)) { unknown.push(obj); continue; }
      if (live.has(first)) { liveCount++; continue; }
      orphans.push(obj);
    }

    // health-vault only: a surviving metadata row means something can still
    // reach the object, whatever the account table says.
    let referenced = [];
    if (bucket === 'health-vault' && orphans.length > 0) {
      const hits = await referencedPaths(orphans.map((o) => o.path));
      referenced = orphans.filter((o) => hits.has(o.path));
      for (let i = orphans.length - 1; i >= 0; i--) {
        if (hits.has(orphans[i].path)) orphans.splice(i, 1);
      }
    }

    const wasted = orphans.reduce((n, o) => n + o.size, 0);
    report.buckets[bucket] = {
      total: objects.length,
      live: liveCount,
      orphaned: orphans.length,
      orphanedBytes: wasted,
      skippedUnknownPath: unknown.length,
      skippedStillReferenced: referenced.length,
      orphanPaths: orphans.map((o) => o.path),
    };

    log(`── ${bucket} ──`);
    log(`  ${objects.length} object(s): ${liveCount} owned by live accounts, ${orphans.length} orphaned (${mb(wasted)})`);
    if (unknown.length) {
      log(`  ${unknown.length} SKIPPED — path does not start with a user id, so ownership is not knowable:`);
      unknown.slice(0, 10).forEach((o) => log(`      ${o.path}`));
      if (unknown.length > 10) log(`      … and ${unknown.length - 10} more`);
    }
    if (referenced.length) {
      log(`  ${referenced.length} SKIPPED — account is gone but a health_records row still points at them.`);
      log(`      This should be impossible (the row cascades with the account). Worth investigating:`);
      referenced.slice(0, 10).forEach((o) => log(`      ${o.path}`));
    }
    orphans.forEach((o) => log(`      ORPHAN  ${o.path}  (${mb(o.size)})`));
    log('');

    orphans.forEach((o) => toDelete.push({ bucket, path: o.path }));
  }

  const totalBytes = Object.values(report.buckets).reduce((n, b) => n + b.orphanedBytes, 0);
  log(`${toDelete.length} orphaned object(s), ${mb(totalBytes)} total.\n`);

  if (toDelete.length === 0) {
    if (AS_JSON) console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (!DO_DELETE) {
    log('Dry run. To remove these:');
    log(`  node db/scripts/purge-orphan-storage.mjs${ONLY_BUCKET ? ` --bucket ${ONLY_BUCKET}` : ''} --delete --confirm DELETE\n`);
    if (AS_JSON) console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (!CONFIRMED) {
    log('--delete was given without --confirm DELETE. Nothing was removed.\n');
    if (AS_JSON) console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  // The blast-radius cap. If the classification is ever wrong, this is what
  // stands between a bug and an empty bucket.
  if (toDelete.length > MAX_DELETE) {
    log(`REFUSING: ${toDelete.length} objects exceeds --max ${MAX_DELETE}.`);
    log('Read the list above. If it is genuinely correct, re-run with a higher --max.\n');
    process.exit(1);
  }

  for (const bucket of BUCKETS) {
    const paths = toDelete.filter((d) => d.bucket === bucket).map((d) => d.path);
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const n = await removeBatch(bucket, batch);
      report.deleted += n;
      log(`  ${bucket}: removed ${n} object(s)`);
    }
  }

  log(`\nDone. ${report.deleted} object(s) removed, ${mb(totalBytes)} reclaimed.\n`);
  if (AS_JSON) console.log(JSON.stringify(report, null, 2));
})().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
