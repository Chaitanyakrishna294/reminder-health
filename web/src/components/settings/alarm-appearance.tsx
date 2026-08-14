'use client';

/**
 * Settings → Notifications → "Notification style".
 *
 * The picture and the sound the full-screen dose alarm uses. Both live on the
 * PHONE, in app-private storage: the alarm has to show and play them in airplane
 * mode with the app process dead, so nothing here is a URL and nothing is
 * fetched at fire time.
 *
 * APP ONLY, and it says so rather than hiding. This configures a native Android
 * alarm screen that a browser does not have, and the picker itself is Kotlin —
 * the webview cannot write to app-private storage. A section that silently
 * vanished on desktop would leave someone hunting for a setting a friend told
 * them about.
 *
 * ELDERLY SEES THE RESULT, NOT THE PICKERS. Per the density rules, choosing a
 * backdrop is caregiver territory — it is a configuration decision with a file
 * browser attached, on a screen whose whole job is to have fewer elements. The
 * alarm still shows whatever was chosen; that is the part elderly mode is for.
 */

import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Music, Check } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';
import {
  clearAlarmSound,
  getAlarmMedia,
  isNativeApp,
  pickAlarmImage,
  pickAlarmSound,
  setAlarmImage,
  type AlarmMediaState,
} from '@/lib/native/schedule-bridge';

/** Bundled keys are Kotlin's; these are the words for them. */
const BUNDLED_LABELS: Record<string, string> = {
  dawn: 'Sunrise',
  calm: 'Daylight',
  night: 'Night',
};

const BUNDLED_SWATCH: Record<string, string> = {
  dawn: 'linear-gradient(180deg, #F6C98A 0%, #E8A44E 50%, #8A4A2E 100%)',
  calm: 'linear-gradient(180deg, #8FC9DE 0%, #59A6C6 50%, #2A5D77 100%)',
  night: 'linear-gradient(180deg, #3D4A8F 0%, #232A57 50%, #12162E 100%)',
};

export default function AlarmAppearance() {
  const { isElderly } = useUiMode();
  const [media, setMedia] = useState<AlarmMediaState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAlarmMedia().then((state) => {
      if (cancelled) return;
      setMedia(state);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const label = isElderly ? 'text-xl' : 'text-sm';
  const body = isElderly ? 'text-base' : 'text-xs';

  if (!loaded) return null;

  // Not the app, or an APK older than this feature.
  if (!media) {
    if (isNativeApp()) return null;
    return (
      <section className="bg-card border border-border rounded-3xl p-5">
        <p className={`font-extrabold text-foreground ${label}`}>Notification style</p>
        <p className={`text-muted-foreground font-semibold mt-1 text-balance ${body}`}>
          Choose the picture and sound your dose alarm uses. This one is set in the
          Android app, because the alarm keeps them on the phone so they work with no
          internet.
        </p>
      </section>
    );
  }

  // Elderly sees the result on the alarm itself; the pickers are caregiver work.
  if (isElderly) return null;

  const choose = async (run: () => Promise<unknown>, cancelledNote?: string) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = (await run()) as AlarmMediaState & { picked?: boolean; error?: string };
      if (result && 'picked' in result && result.picked === false) {
        if (result.error) setNote(result.error);
        else if (cancelledNote) setNote(null);
        // Re-read: a cancel changes nothing, but a failed import may have.
        setMedia(await getAlarmMedia());
        return;
      }
      setMedia(await getAlarmMedia());
      setNote('Saved. Your next alarm will use it.');
    } catch {
      setNote('Could not change that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const imageOption = (key: string, name: string, swatch?: string, active?: boolean) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={!!active}
      disabled={busy}
      onClick={() => choose(key === 'custom' ? pickAlarmImage : () => setAlarmImage(key))}
      className={`relative rounded-2xl overflow-hidden border-2 transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        active ? 'border-primary-strong' : 'border-border hover:border-muted-foreground/40'
      }`}
      style={{ width: 96, minHeight: 96 }}
    >
      <span
        aria-hidden
        className="block w-full h-16"
        style={{ background: swatch ?? 'var(--muted)' }}
      />
      <span className={`block px-2 py-1.5 font-bold text-foreground ${isElderly ? 'text-base' : 'text-[11px]'}`}>
        {name}
      </span>
      {active && (
        <span
          aria-hidden
          className="absolute top-1.5 right-1.5 rounded-full bg-primary-strong text-primary-strong-foreground p-0.5"
        >
          <Check className="w-3 h-3" />
        </span>
      )}
    </button>
  );

  return (
    <section className="bg-card border border-border rounded-3xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`shrink-0 rounded-2xl flex items-center justify-center bg-muted text-muted-foreground ${
            isElderly ? 'w-14 h-14' : 'w-10 h-10'
          }`}
        >
          <ImageIcon className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
        </span>
        <div className="min-w-0">
          <p className={`font-extrabold text-foreground ${label}`}>Notification style</p>
          <p className={`text-muted-foreground font-semibold mt-0.5 text-balance ${body}`}>
            The picture and sound your full-screen alarm uses. They are kept on this
            phone, so they still work with no internet.
          </p>
        </div>
      </div>

      <div>
        <p className={`font-bold text-foreground mb-2 ${body}`}>Full-screen image</p>
        <div role="radiogroup" aria-label="Full-screen image" className="flex flex-wrap gap-2">
          {imageOption('none', 'None', undefined, media.imageChoice === 'none')}
          {media.bundled.map((key) =>
            imageOption(key, BUNDLED_LABELS[key] ?? key, BUNDLED_SWATCH[key], media.imageChoice === key),
          )}
          {imageOption(
            'custom',
            media.hasCustomImage ? 'Your photo' : 'Choose photo',
            media.hasCustomImage ? 'var(--muted)' : undefined,
            media.imageChoice === 'custom',
          )}
        </div>
        <p className={`text-muted-foreground font-semibold mt-2 text-balance ${body}`}>
          A photo you choose is copied onto this phone, so you can delete the original
          from your gallery and the alarm still shows it.
        </p>
      </div>

      <div>
        <p className={`font-bold text-foreground mb-2 flex items-center gap-1.5 ${body}`}>
          <Music aria-hidden className="w-3.5 h-3.5" />
          Full-screen sound
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => choose(clearAlarmSound)}
            className={`rounded-2xl px-4 font-black transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              isElderly ? 'min-h-16 text-lg' : 'min-h-12 text-sm'
            } ${
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
            onClick={() => choose(pickAlarmSound)}
            className={`rounded-2xl px-4 font-black transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              isElderly ? 'min-h-16 text-lg' : 'min-h-12 text-sm'
            } ${
              media.soundChoice === 'custom'
                ? 'bg-primary-strong text-primary-strong-foreground'
                : 'bg-muted text-foreground hover:bg-muted/70'
            }`}
          >
            {media.hasCustomSound ? 'Your sound' : 'Choose sound'}
          </button>
        </div>
      </div>

      {note && (
        <p className={`font-bold text-muted-foreground ${body}`} role="status">
          {note}
        </p>
      )}
    </section>
  );
}
