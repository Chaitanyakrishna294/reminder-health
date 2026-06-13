import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import EditMedicationForm from './edit-form';

interface PageProps {
  params: Promise<{ id: string }>;
}

export const revalidate = 0; // Dynamic, always fresh

export default async function EditMedicationPage({ params }: PageProps) {
  const resolvedParams = await params;
  const medId = parseInt(resolvedParams.id);
  
  if (isNaN(medId)) {
    redirect('/medications');
  }

  const supabase = await createClient();

  // 1. Resolve User
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/login');

  const myTelegramChatId = profile.telegram_chat_id;

  // 2. Fetch medication detail
  const { data: medication, error: medErr } = await supabase
    .from('medications')
    .select('*')
    .eq('id', medId)
    .single();

  if (medErr || !medication) {
    redirect('/medications');
  }

  // Verify access permissions (users can only edit their own medications)
  if (medication.telegram_id !== myTelegramChatId) {
    redirect('/medications');
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Edit Medication Details</h1>
        <p className="text-sm text-muted-foreground">
          Update scheduled timings, active limits, priority configurations, and inventory values.
        </p>
      </div>

      <EditMedicationForm medication={medication} />
    </div>
  );
}
