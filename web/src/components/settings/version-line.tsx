'use client';

/**
 * The version line at the foot of Settings.
 *
 * It exists for support, not for pride. This app runs in `server.url` mode, so
 * the APK on someone's phone and the web build it loads are two independently
 * shipped things that can disagree — "rebuild the APK AND deploy the web" is a
 * documented, already-hit failure mode. When a tester says "the button does
 * nothing", the first question is which build they are actually looking at, and
 * until now nothing on screen could answer it.
 *
 * So it shows BOTH halves:
 *   - the web version + commit, which changes on every Vercel deploy;
 *   - whether this is the app or a browser, since that decides which half of a
 *     mismatch is suspect.
 *
 * `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` is injected by Vercel at build time. It is
 * absent in local dev, where "dev" is the honest answer.
 */

import pkg from '../../../package.json';
import { useDensity } from '@/context/density-context';

const SHA = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

export default function VersionLine() {
  const { isApp } = useDensity();
  const build = SHA ? SHA.slice(0, 7) : 'dev';

  return (
    // Deliberately quiet: muted, small, centred, no card. A version string is
    // reference material for the one conversation that needs it, not a row
    // competing with Log out.
    <p className="pt-1 pb-2 text-center font-mono text-[11px] text-muted-foreground tabular-nums">
      Version {pkg.version} · {build} · {isApp ? 'app' : 'browser'}
    </p>
  );
}
