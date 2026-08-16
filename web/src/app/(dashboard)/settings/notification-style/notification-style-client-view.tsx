'use client';

/**
 * Settings → Notification style.
 *
 * The picture and the sound the full-screen dose alarm uses. Both live on the
 * PHONE, in app-private storage: the alarm has to show and play them in airplane
 * mode with the app process dead, so nothing here is a URL and nothing is
 * fetched at fire time.
 *
 * ## The shape of this screen
 *
 *   Effects  [ none · sunrise · daylight · night · your photo ]  [ listen ]
 *                        ── the preview ──
 *                       Full-screen sound
 *
 * The controls sit ABOVE the thing they change and the preview is the middle of
 * the screen, because the preview is the answer and everything else is the
 * question. The effects row is one line of swatches with no captions: with the
 * real alarm rendered directly underneath, a word describing a gradient is worse
 * than the gradient itself.
 *
 * THE PREVIEW IS A RENDER OF THE REAL SCREEN, not a recreation — native inflates
 * the same layout the alarm uses and hands back a bitmap. See renderAlarmPreview.
 * A settings preview that quietly stops matching would be a promise about a
 * screen someone next sees at 3am, with no way to check it until then.
 *
 * APP ONLY, and it says so rather than hiding. This configures a native Android
 * alarm screen a browser does not have, and the picker itself is Kotlin — the
 * webview cannot write to app-private storage. A page that silently showed
 * nothing on desktop would leave someone hunting for a setting a friend told
 * them about.
 *
 * ELDERLY SEES THE RESULT, NOT THE PICKERS. Per the density rules, choosing a
 * backdrop is caregiver territory — a configuration decision with a file browser
 * attached. The alarm still shows whatever was chosen; that is the part elderly
 * mode is for.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Ban, Check, Image as ImageIcon, Music, Play, Square } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';
import {
  clearAlarmSound,
  getAlarmMedia,
  isNativeApp,
  pickAlarmImage,
  pickAlarmSound,
  previewAlarmSound,
  renderAlarmPreview,
  setAlarmImage,
  stopAlarmSoundPreview,
  type AlarmMediaState,
} from '@/lib/native/schedule-bridge';

/** Bundled keys are Kotlin's; these are the words and swatches for them. */
const BUNDLED_LABELS: Record<string, string> = {
  dawn: 'Sunrise',
  calm: 'Daylight',
  night: 'Night',
};

/**
 * Swatches mirror `alarm_bg_*.xml`. They are a THUMBNAIL of the choice, not the
 * source of truth — the preview below renders the real drawable, so if these
 * ever drift the screen still tells the truth about what the alarm looks like.
 */
const BUNDLED_SWATCH: Record<string, string> = {
  dawn: 'linear-gradient(180deg, #F6C98A 0%, #E8A44E 50%, #8A4A2E 100%)',
  calm: 'linear-gradient(180deg, #8FC9DE 0%, #59A6C6 50%, #2A5D77 100%)',
  night: 'linear-gradient(180deg, #3D4A8F 0%, #232A57 50%, #12162E 100%)',
};

/** Rendered wider than it is shown, so the miniature stays sharp on a dense screen. */
const PREVIEW_RENDER_WIDTH = 560;

export default function NotificationStyleClientView() {
  const { isElderly } = useUiMode();
  const [media, setMedia] = useState<AlarmMediaState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const refreshPreview = useCallback(async () => {
    setPreview(await renderAlarmPreview(PREVIEW_RENDER_WIDTH));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAlarmMedia().then(async (state) => {
      if (cancelled) return;
      setMedia(state);
      setLoaded(true);
      if (state) await refreshPreview();
    });
    return () => {
      cancelled = true;
      // Leaving the page must not leave a tone playing behind it.
      void stopAlarmSoundPreview();
    };
  }, [refreshPreview]);

  const body = isElderly ? 'text-base' : 'text-sm';

  if (!loaded) return null;

  if (!media) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Header isElderly={isElderly} />
        <section className="card-lift p-5">
          <p className={`text-muted-foreground font-semibold text-balance ${body}`}>
            {isNativeApp()
              ? 'This version of the app cannot change the alarm style yet. Updating the app will add it.'
              : 'This one is set in the Android app, because the alarm keeps the picture and sound on the phone so they work with no internet.'}
          </p>
        </section>
      </div>
    );
  }

  if (isElderly) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Header isElderly={isElderly} />
        <section className="card-lift p-5">
          <p className={`text-muted-foreground font-semibold text-balance ${body}`}>
            Your alarm picture and sound are already set. Someone in your care circle can
            change them from their own phone.
          </p>
        </section>
      </div>
    );
  }

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = (await action()) as { picked?: boolean; error?: string };
      setMedia(await getAlarmMedia());
      await refreshPreview();
      if (result && result.picked === false) {
        // Cancelling a file picker is the commonest outcome and is not a failure.
        if (result.error) setNote(result.error);
        return;
      }
      setNote('Saved. Your next alarm will use it.');
    } catch {
      setNote('Could not change that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggleSound = async () => {
    if (playing) {
      await stopAlarmSoundPreview();
      setPlaying(false);
      return;
    }
    const started = await previewAlarmSound();
    setPlaying(started);
    // It stops itself after ~10s; reflect that without polling for it.
    if (started) window.setTimeout(() => setPlaying(false), 10_000);
  };

  const swatch = (key: string, name: string, background?: string, icon?: React.ReactNode) => {
    const active = media.imageChoice === key;
    return (
      <button
        key={key}
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={name}
        title={name}
        disabled={busy}
        onClick={() => run(key === 'custom' ? pickAlarmImage : () => setAlarmImage(key))}
        className={`relative flex-1 min-w-[44px] aspect-square rounded-2xl overflow-hidden border-2 flex items-center justify-center transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          active ? 'border-primary-strong' : 'border-border hover:border-muted-foreground/40'
        }`}
        style={background ? { background } : undefined}
      >
        {icon}
        {active && (
          <span
            aria-hidden
            className="absolute bottom-1 right-1 rounded-full bg-primary-strong text-primary-strong-foreground p-0.5"
          >
            <Check className="w-3 h-3" />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Header isElderly={isElderly} />

      <section className="card-lift p-5 space-y-5">
        {/* EFFECTS — one line, controls above the thing they change.
            min-w on each swatch keeps the 44px tap floor, and the row scrolls
            rather than shrinking below it on a very narrow phone: "fits on one
            line" must not win against "can actually be tapped". */}
        <div>
          <p className={`font-bold text-foreground mb-2 ${isElderly ? 'text-lg' : 'text-xs'}`}>Effects</p>
          <div className="flex items-center gap-2 overflow-x-auto">
            <div role="radiogroup" aria-label="Full-screen image" className="flex flex-1 items-center gap-2">
              {swatch('none', 'No picture', undefined, <Ban aria-hidden className="w-4 h-4 text-muted-foreground" />)}
              {media.bundled.map((key) =>
                swatch(key, BUNDLED_LABELS[key] ?? key, BUNDLED_SWATCH[key]),
              )}
              {swatch(
                'custom',
                media.hasCustomImage ? 'Your photo' : 'Choose a photo',
                undefined,
                <ImageIcon aria-hidden className="w-4 h-4 text-muted-foreground" />,
              )}
            </div>

            {/* A sound cannot be shown, so it gets a listen. Sits with the
                effects because it previews, rather than chooses — the choosing
                is below the preview. */}
            <button
              type="button"
              onClick={toggleSound}
              aria-label={playing ? 'Stop the sound' : 'Hear the alarm sound'}
              title={playing ? 'Stop' : 'Hear the alarm sound'}
              className="shrink-0 w-11 h-11 rounded-2xl bg-muted text-foreground flex items-center justify-center hover:bg-muted/70 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {playing ? <Square aria-hidden className="w-4 h-4" /> : <Music aria-hidden className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* THE PREVIEW — the middle of the screen, and the answer to everything
            above it. `pointer-events-none` and no interactive children: it is a
            picture of the alarm, not the alarm. The alt text carries the meaning
            so a screen reader is not announcing a Taken button that does
            nothing. */}
        {preview && (
          <div className="flex justify-center">
            <div
              className="w-[70%] rounded-3xl overflow-hidden border border-border pointer-events-none select-none"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="A preview of your full-screen alarm, showing a sample medicine with the Taken, Skip and Snooze buttons."
                className="block w-full h-auto"
                draggable={false}
              />
            </div>
          </div>
        )}

        {/* FULL-SCREEN SOUND — below the preview, because it is a choice rather
            than a result. */}
        <div>
          <p className={`font-bold text-foreground mb-2 ${isElderly ? 'text-lg' : 'text-xs'}`}>
            Full-screen sound
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(clearAlarmSound)}
              className={`flex-1 min-w-[44%] rounded-2xl px-4 min-h-12 font-black transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${body} ${
                media.soundChoice !== 'custom'
                  ? 'bg-primary-strong text-primary-strong-foreground'
                  : 'bg-muted text-foreground hover:bg-muted/70'
              }`}
            >
              Default tone
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(pickAlarmSound)}
              className={`flex-1 min-w-[44%] rounded-2xl px-4 min-h-12 font-black transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${body} ${
                media.soundChoice === 'custom'
                  ? 'bg-primary-strong text-primary-strong-foreground'
                  : 'bg-muted text-foreground hover:bg-muted/70'
              }`}
            >
              {media.hasCustomSound ? 'Your sound' : 'Choose a sound'}
            </button>
          </div>
          <p className={`text-muted-foreground font-semibold mt-2 text-balance ${isElderly ? 'text-base' : 'text-xs'}`}>
            A photo or sound you choose is copied onto this phone, so you can delete the
            original and your alarm still works.
          </p>
        </div>

        {note && (
          <p className={`font-bold text-muted-foreground ${body}`} role="status">
            {note}
          </p>
        )}
      </section>
    </div>
  );
}

function Header({ isElderly }: { isElderly: boolean }) {
  return (
    <header className="px-1">
      <h1 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-4xl' : 'title-page'}`}>
        Notification style
      </h1>
      <p className={`text-muted-foreground font-semibold mt-1 text-balance ${isElderly ? 'text-base' : 'text-sm'}`}>
        The picture and sound your full-screen alarm uses.
      </p>
    </header>
  );
}
