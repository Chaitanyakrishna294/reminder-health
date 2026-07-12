import { Loader2 } from 'lucide-react';

export default function SettingsLoading() {
  return (
    <div className="max-w-2xl mx-auto mt-16 flex flex-col items-center gap-4">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
      <p className="text-sm text-muted-foreground font-semibold">Loading settings...</p>
    </div>
  );
}
