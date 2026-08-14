'use client';

/**
 * Settings → Display. Owns elderly mode, the view lock, and the theme.
 *
 * These three moved here wholesale from the old single-page Settings; the rules
 * they carry are unchanged and each is load-bearing:
 *
 *  - THE THEME TOGGLE IS THE APP'S ONLY ONE. It used to be a one-tap moon in the top
 *    bar, one mis-tap from repainting the whole app. Light is the default and dark is
 *    a deliberate act (CLAUDE.md).
 *  - ELDERLY IS ALWAYS LIGHT, so the theme switch is disabled there and says why
 *    rather than silently ignoring the choice.
 *  - THE LOCK LIVES HERE AND NOWHERE ELSE, which is exactly why this page must stay
 *    reachable in elderly mode. The anti-jail rule: a lock that can hide the way to
 *    unlock it is a trap, not a lock.
 *
 * The confirms are deliberately ASYMMETRIC. Leaving elderly warns what changes
 * ("Text will become smaller") because that is the disorienting direction; entering
 * it does not, because bigger text has never confused anyone.
 */

import React from 'react';
import { useUiMode } from '@/context/ui-mode-context';
import { useTheme } from '@/context/theme-context';

function Switch({
  checked, onClick, disabled = false, isElderly,
}: {
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
  isElderly: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={`shrink-0 self-start sm:self-center inline-flex items-center gap-3 rounded-2xl border transition-all bg-card hover:bg-muted border-border disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        isElderly ? 'h-16 px-5' : 'h-12 px-4'
      }`}
    >
      <span className={`font-bold text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>
        {checked ? 'On' : 'Off'}
      </span>
      <span
        aria-hidden
        className={`relative shrink-0 rounded-full transition-colors ${
          isElderly ? 'w-16 h-9' : 'w-11 h-6'
        } ${checked ? 'bg-primary' : 'bg-input'}`}
      >
        <span
          className={`absolute top-[2px] bg-white border border-border rounded-full transition-all ${
            isElderly ? 'h-8 w-8' : 'h-5 w-5'
          } ${checked
              ? (isElderly ? 'left-[calc(100%-2.125rem)]' : 'left-[calc(100%-1.375rem)]')
              : 'left-[2px]'}`}
        />
      </span>
    </button>
  );
}

function Row({
  title, description, children, isElderly,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  isElderly: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-muted/30 border border-border/80 rounded-2xl p-4">
      <div className="space-y-0.5">
        <span className={`font-extrabold text-foreground block ${isElderly ? 'text-xl' : 'text-sm'}`}>
          {title}
        </span>
        <span className={`text-muted-foreground block font-semibold ${isElderly ? 'text-base' : 'text-xs'}`}>
          {description}
        </span>
      </div>
      {children}
    </div>
  );
}

export default function DisplayClientView() {
  const { isElderly, toggleMode, uiModeLocked, setUiModeLocked, navLabelsPreference, setNavLabels } = useUiMode();
  const { theme, setTheme } = useTheme();

  return (
    <div className={`max-w-2xl mx-auto ${isElderly ? 'space-y-7' : 'space-y-6'}`}>
      <header className="px-1">
        <h1 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-4xl' : 'text-2xl'}`}>
          Display
        </h1>
        <p className={`text-muted-foreground font-semibold ${isElderly ? 'text-lg mt-2' : 'text-xs mt-1'}`}>
          How the app looks and how big everything is.
        </p>
      </header>

      <div className="space-y-3">
        <Row
          isElderly={isElderly}
          title="Large text and buttons"
          description="Bigger writing, bigger buttons, and fewer things on each screen."
        >
          <Switch
            isElderly={isElderly}
            checked={isElderly}
            disabled={uiModeLocked}
            onClick={() => {
              if (isElderly && !window.confirm('Switch to the normal view?\n\nText will become smaller.')) return;
              toggleMode();
            }}
          />
        </Row>

        {/* Offered only while elderly is on — it is the situation it protects. */}
        {isElderly && (
          <Row
            isElderly={isElderly}
            title="Lock this view"
            description="Prevents switching views by accident. You can change this here anytime."
          >
            <Switch
              isElderly={isElderly}
              checked={uiModeLocked}
              onClick={async () => {
                if (uiModeLocked) {
                  if (!window.confirm('Unlock this view?\n\nThe view button will come back in the top bar.')) return;
                  await setUiModeLocked(false);
                } else {
                  await setUiModeLocked(true);
                }
              }}
            />
          </Row>
        )}

        {/* Sits with the other "how much do you want on screen" controls rather
            than in a nav section, because that is the question it answers.

            Reads navLabelsPreference, NOT showNavLabels: in elderly the switch
            must show what the user chose, while the row's own description says
            plainly that large text is overriding it. A switch that silently reads
            back "on" because something else forced it teaches people their choice
            did not save. */}
        <Row
          isElderly={isElderly}
          title="Names under the icons"
          description={isElderly
            ? 'Large text always shows the names, so the buttons at the bottom are easy to tell apart.'
            : 'Shows a word under each button at the bottom — Today, Care, Meds, Vault, Settings.'}
        >
          <Switch
            isElderly={isElderly}
            checked={isElderly || navLabelsPreference}
            disabled={isElderly}
            onClick={() => setNavLabels(!navLabelsPreference)}
          />
        </Row>

        <Row
          isElderly={isElderly}
          title="Dark theme"
          description={isElderly
            ? 'Large text always uses the light theme, so it stays easy to read.'
            : 'The app stays light unless you turn this on. It never follows your phone’s setting.'}
        >
          <Switch
            isElderly={isElderly}
            checked={theme === 'dark' && !isElderly}
            disabled={isElderly}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          />
        </Row>
      </div>
    </div>
  );
}
