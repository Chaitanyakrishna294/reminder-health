'use client';

// Voice-call reminders page body — hosts the CallSchedule capture. Reached from the
// Care+ hub's "Voice-call reminders" shortcut; the page gates access to members.
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';
import CallSchedule from '@/components/settings/call-schedule';

export default function VoiceRemindersView({ telegramId }: { telegramId: string }) {
  const { isElderly } = useUiMode();
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <Link
        href="/care-plus"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Care+
      </Link>
      <CallSchedule telegramId={telegramId} isElderly={isElderly} />
    </div>
  );
}
