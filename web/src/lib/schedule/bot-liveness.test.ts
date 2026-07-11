// Dependency-free checks. Run:
//   node --experimental-strip-types src/lib/schedule/bot-liveness.test.ts
import assert from 'node:assert';
import { isBotAlive, isRecentlySent } from './bot-liveness.ts';

const now = Date.parse('2026-07-11T10:00:00.000Z');

// ── isBotAlive: fresh beat is alive, stale/edge/missing is dead (fail-safe) ──
assert.equal(isBotAlive(new Date(now - 60_000).toISOString(), now), true);   // 1 min ago
assert.equal(isBotAlive(new Date(now - 240_000).toISOString(), now), false); // 4 min ago
assert.equal(isBotAlive(new Date(now - 180_000).toISOString(), now), false); // exactly 3 min -> dead (not < threshold)
assert.equal(isBotAlive(new Date(now - 179_000).toISOString(), now), true);  // just under threshold
assert.equal(isBotAlive(null, now), false);
assert.equal(isBotAlive(undefined, now), false);
assert.equal(isBotAlive('not-a-date', now), false);

// ── isRecentlySent: 60s duplicate-send guard ──
assert.equal(isRecentlySent(new Date(now - 30_000).toISOString(), now), true);
assert.equal(isRecentlySent(new Date(now - 90_000).toISOString(), now), false);
assert.equal(isRecentlySent(null, now), false);

console.log('bot-liveness: all checks passed');
