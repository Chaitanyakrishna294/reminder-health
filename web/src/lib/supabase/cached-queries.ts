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

// Get active caregiver connection list
export const getCachedCaregiverLinks = cache(async (telegramChatId: string) => {
  const supabase = await createClient();
  const { data: caregiverLinks } = await supabase
    .from('active_caregiver_links')
    .select('connection_id,caregiver_chat_id,caregiver_name,patient_telegram_id,connection_status,relationship_type,is_primary,can_view_medications,can_view_vault,can_view_reports,can_edit_medications,can_receive_escalations')
    .eq('caregiver_chat_id', telegramChatId)
    .eq('is_active', true);
  return caregiverLinks || [];
});

// Get patient's full name and phone number from profile
export const getCachedPatientProfile = cache(async (patientTelegramId: string) => {
  const supabase = await createClient();
  const { data: patientProfile, error } = await supabase
    .from('profiles')
    .select('id,full_name,phone_number')
    .eq('telegram_chat_id', patientTelegramId)
    .single();

  if (error) {
    if (error.message?.includes('phone_number') || error.code === '42703') {
      const { data: fallbackProfile } = await supabase
        .from('profiles')
        .select('id,full_name')
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


// Resolve full user context data in a single request cache (strictly user-centric for main dashboard)
export const resolveUserData = cache(async () => {
  const user = await getCachedUser();
  if (!user) return null;

  const profile = await getCachedProfile(user.id);
  if (!profile) return null;

  const userRole = profile.role as 'PATIENT' | 'CAREGIVER';
  const myTelegramChatId = profile.telegram_chat_id;

  // Since Sprint 5.6B uses Care Circle Driven Navigation, the main dashboard 
  // target is always the user's own profile space.
  const targetChatId = myTelegramChatId;
  const patientName = profile.full_name || '';
  const patientPhone = profile.phone_number || '';

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

