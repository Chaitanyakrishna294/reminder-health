import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import HealthVaultClientView from './health-vault-client-view';

export const revalidate = 0; // Dynamic rendering, always fresh

export default async function HealthVaultPage() {
  const userData = await resolveUserData();
  if (!userData) {
    redirect('/login');
  }

  const { user, profile, userRole, patientName } = userData;

  const supabase = await createClient();

  // Fetch categories for this user with related record counts.
  // Caregiver access is not implemented in this foundation sprint.
  const { data: categories } = await supabase
    .from('health_categories')
    .select('id, name, is_default, created_at, health_records(count)')
    .eq('user_id', user.id)
    .order('name', { ascending: true });

  return (
    <HealthVaultClientView
      categories={categories || []}
      userRole={userRole}
      patientName={patientName || ''}
    />
  );
}
