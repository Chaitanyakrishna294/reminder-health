import { cache } from 'react';
import { createClient } from './server';
import { cookies } from 'next/headers';

// Get authenticated auth user
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
});

// Get profiles row by id
export const getCachedProfile = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id,role,full_name,telegram_chat_id,phone_number')
    .eq('id', userId)
    .single();

  if (error) {
    if (error.message?.includes('phone_number') || error.code === '42703') {
      const { data: fallbackProfile } = await supabase
        .from('profiles')
        .select('id,role,full_name,telegram_chat_id')
        .eq('id', userId)
        .single();
      return fallbackProfile ? { ...fallbackProfile, phone_number: null } as any : null;
    }
    if (error.code !== 'PGRST116') {
      console.error('getCachedProfile error:', error);
    }
  }
  return profile;
});

// Get active caregiver link info
export const getCachedCaregiverLink = cache(async (telegramChatId: string) => {
  const supabase = await createClient();
  const { data: caregiverLink } = await supabase
    .from('caregiver_info')
    .select('id,caregiver_chat_id,patient_telegram_id,is_active,connection_status')
    .eq('caregiver_chat_id', telegramChatId)
    .eq('is_active', true)
    .single();
  return caregiverLink;
});

// Get patient's full name and phone number from profile
export const getCachedPatientProfile = cache(async (patientTelegramId: string) => {
  const supabase = await createClient();
  const { data: patientProfile, error } = await supabase
    .from('profiles')
    .select('full_name,phone_number')
    .eq('telegram_chat_id', patientTelegramId)
    .single();

  if (error) {
    if (error.message?.includes('phone_number') || error.code === '42703') {
      const { data: fallbackProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('telegram_chat_id', patientTelegramId)
        .single();
      return fallbackProfile ? { ...fallbackProfile, phone_number: null } as any : null;
    }
    if (error.code !== 'PGRST116') {
      console.error('getCachedPatientProfile error:', error);
    }
  }
  return patientProfile;
});


// Resolve full user context data in a single request cache
export const resolveUserData = cache(async () => {
  const user = await getCachedUser();
  if (!user) return null;

  const profile = await getCachedProfile(user.id);
  if (!profile) return null;

  const userRole = profile.role as 'PATIENT' | 'CAREGIVER';
  const myTelegramChatId = profile.telegram_chat_id;

  // Retrieve view-mode from cookies
  const cookieStore = await cookies();
  const viewModeCookie = cookieStore.get('view-mode')?.value as 'PATIENT_SELF' | 'PATIENT_MONITOR' | undefined;
  const activeViewMode = viewModeCookie || 'PATIENT_SELF';

  let targetChatId: string | null = null;
  let patientName = '';
  let patientPhone = '';

  if (userRole === 'PATIENT') {
    targetChatId = myTelegramChatId;
    patientName = profile.full_name || '';
    patientPhone = profile.phone_number || '';
  } else {
    // Caregiver account
    if (activeViewMode === 'PATIENT_MONITOR' && myTelegramChatId) {
      const caregiverLink = await getCachedCaregiverLink(myTelegramChatId);
      if (caregiverLink && caregiverLink.patient_telegram_id && caregiverLink.connection_status === 'ACCEPTED') {
        const patientId = caregiverLink.patient_telegram_id;
        targetChatId = patientId;
        const patientProfile = await getCachedPatientProfile(patientId);
        patientName = patientProfile ? patientProfile.full_name : 'Your Patient';
        patientPhone = patientProfile ? (patientProfile.phone_number || '') : '';
      }
    } else {
      // PATIENT_SELF view (caregiver's own account)
      targetChatId = myTelegramChatId;
      patientName = profile.full_name || '';
      patientPhone = profile.phone_number || '';
    }
  }

  return {
    user,
    profile,
    userRole,
    myTelegramChatId,
    targetChatId,
    patientName,
    patientPhone,
  };
});
