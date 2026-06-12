import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import HealthVaultClientView from './health-vault-client-view';

export const revalidate = 0; // Dynamic rendering, always fresh

interface PageProps {
  searchParams: Promise<{
    patientId?: string;
  }>;
}

export default async function HealthVaultPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const patientId = resolvedSearchParams.patientId;

  const userData = await resolveUserData();
  if (!userData) {
    redirect('/login');
  }

  const { user } = userData;
  const supabase = await createClient();

  let targetUserId = user.id;
  let viewRole: 'PATIENT' | 'CAREGIVER' = 'PATIENT';
  let targetPatientName = '';

  if (patientId) {
    // 1. Verify Caregiver Connection
    const { data: connection, error: connError } = await supabase
      .from('caregiver_connections')
      .select('id, can_view_vault')
      .eq('patient_profile_id', patientId)
      .eq('caregiver_profile_id', user.id)
      .eq('connection_status', 'ACCEPTED')
      .eq('is_active', true)
      .single();

    if (connError || !connection || !connection.can_view_vault) {
      // Access denied or not authorized
      redirect('/care-circle');
    }

    // 2. Fetch patient profile details
    const { data: patientProfile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', patientId)
      .single();

    if (profileError || !patientProfile) {
      redirect('/care-circle');
    }

    targetUserId = patientId;
    viewRole = 'CAREGIVER';
    targetPatientName = patientProfile.full_name || 'Patient';
  }

  // Fetch categories for this user with related record counts (active files only).
  const { data: categories } = await supabase
    .from('health_categories')
    .select('id, name, is_default, created_at, health_records(count)')
    .eq('user_id', targetUserId)
    .is('health_records.deleted_at', null)
    .order('name', { ascending: true });

  return (
    <HealthVaultClientView
      categories={categories || []}
      userRole={viewRole}
      patientName={targetPatientName || ''}
      patientId={patientId}
    />
  );
}

