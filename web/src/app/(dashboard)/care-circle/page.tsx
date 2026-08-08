import React from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import {
  getCareCircleConnections,
  getPatientHealthMetrics,
  PatientHealthMetrics,
  isLiveConnection,
  isPendingConnection,
} from '@/lib/supabase/care-circle-service';
import { createServiceClient } from '@/lib/supabase/service-role';
import { caregiverRoleLabel, patientRoleLabel } from '@/lib/care-circle/relationship';
import { CARE_LABELS } from '@/lib/design/semantics';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge, CountBadge } from '@/components/ui/badge';
import {
  PatientConnectionActions,
  CaregiverConnectionActions,
} from '@/components/care-circle/connection-actions';
import { sourceOf, type ConnectionSource } from '@/lib/care-circle/connection-source';
import {
  Users,
  ArrowLeft,
  ShieldAlert,
  Settings,
  Activity,
  Pill,
  Clock,
  ArrowUpRight,
  TrendingUp,
  UserCheck,
  Link2,
} from 'lucide-react';

export const revalidate = 0; // Dynamic, always fresh

interface PatientCardProps {
  id: string;
  name: string;
  relationship: string;
  isPrimary: boolean;
  telegramId: string;
  status: string;
  source: ConnectionSource;
  userId: string;
}

async function PatientStatusCard({ id, name, relationship, isPrimary, telegramId, status, source, userId }: PatientCardProps) {
  let metrics: PatientHealthMetrics | null = null;
  try {
    metrics = await getPatientHealthMetrics(telegramId);
  } catch (err) {
    console.error(`Failed to load metrics for patient ${telegramId}:`, err);
  }

  // Patient photo (if they share it). Avatars bucket is owner-only, so mint via
  // the service client; gated by the patient's share_photo_with_caregivers flag.
  let avatarUrl: string | null = null;
  try {
    const admin = createServiceClient();
    const { data: prof } = await admin.from('profiles').select('id').eq('telegram_chat_id', telegramId).maybeSingle();
    if (prof?.id) {
      const { data: mp } = await admin
        .from('medical_profiles')
        .select('avatar_path, share_photo_with_caregivers')
        .eq('user_id', prof.id)
        .maybeSingle();
      if (mp?.avatar_path && mp.share_photo_with_caregivers !== false) {
        const { data: signed } = await admin.storage.from('avatars').createSignedUrl(mp.avatar_path, 600);
        avatarUrl = signed?.signedUrl ?? null;
      }
    }
  } catch (err) {
    console.error(`Failed to load avatar for patient ${telegramId}:`, err);
  }

  const statusLabel = metrics 
    ? metrics.complianceStatus === 'missed' 
      ? 'Action Needed'
      : 'On Track'
    : 'Pending';

  const statusColor = metrics
    ? metrics.complianceStatus === 'missed'
      ? 'text-red-600 bg-red-500/10 border-red-500/20'
      : 'text-success bg-success/10 border-success/20'
    : 'text-muted-foreground bg-muted border-border';

  return (
    <div className="group relative bg-card border border-border rounded-3xl p-6 hover:border-slate-200 hover:bg-slate-50/40 transition-all flex flex-col justify-between shadow-sm">
      {/* Arrow Accent */}
      <div className="absolute top-5 right-5 text-muted-foreground group-hover:text-primary transition-colors">
        <ArrowUpRight className="w-5 h-5" />
      </div>

      <div className="space-y-4">
        {/* Profile Info */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20 overflow-hidden">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={`${name} photo`} className="w-full h-full object-cover" />
            ) : (
              name.substring(0, 2).toUpperCase()
            )}
          </div>
          <div>
            <h3 className="font-black text-foreground text-base tracking-tight">{name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] uppercase font-bold text-muted-foreground">{relationship}</span>
              {isPrimary && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary-strong font-bold border border-primary/20">
                  Primary
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Health status indicator */}
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${statusColor}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              metrics?.complianceStatus === 'missed' ? 'bg-danger' : 'bg-success'
            }`} />
            {statusLabel}
          </span>
          {metrics && (
            <span className="text-[11px] text-muted-foreground font-semibold flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-primary" />
              {metrics.adherenceRate}% adherence
            </span>
          )}
        </div>

        <hr className="border-border" />

        {/* Dynamic Health Metrics */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-center gap-2 text-foreground">
            <Pill className="w-4 h-4 text-muted-foreground shrink-0" />
            <span>{metrics?.activeMedicationsCount || 0} Medications</span>
          </div>
          <div className="flex items-center gap-2 text-foreground">
            <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="min-w-0">{metrics?.nextScheduledDoseTime ? `Dose: ${metrics.nextScheduledDoseTime}` : 'No remaining doses'}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <Link
          href={`/care-circle/${telegramId}`}
          className="w-full flex items-center justify-center gap-1.5 h-11 rounded-xl text-xs font-bold bg-muted hover:bg-accent-surface text-foreground transition-all border border-border"
        >
          View Health Overview
        </Link>
        {/* Accept / monitor / remove used to be reachable only from Settings. */}
        <PatientConnectionActions
          connectionId={id}
          patientName={name}
          patientTelegramId={telegramId}
          status={status}
          source={source}
          userId={userId}
        />
      </div>
    </div>
  );
}

export default async function CareCirclePage() {
  const userData = await resolveUserData();
  if (!userData) {
    redirect('/login');
  }

  const { profile, myTelegramChatId } = userData;

  if (!myTelegramChatId) {
    redirect('/link-account');
  }

  // Fetch connections split into care/cared categories
  const { peopleICareFor, peopleCaringForMe, pendingRequestCount } =
    await getCareCircleConnections(myTelegramChatId);
  // The count pills used to include people who hadn't accepted yet.
  const liveICareFor = peopleICareFor.filter(isLiveConnection);
  const liveCaringForMe = peopleCaringForMe.filter(isLiveConnection);

  // Caregiver photos for the "people caring for me" list, gated on each caregiver's
  // own share toggle — the same flag that shows a patient's photo to caregivers,
  // broadened by product decision to mean "my care circle", both directions.
  const caregiverAvatars: Record<string, string> = {};
  const cgIds = peopleCaringForMe
    .map((c: any) => c.caregiver_chat_id)
    .filter((id: any): id is string => Boolean(id));
  if (cgIds.length > 0) {
    try {
      const adminCg = createServiceClient();
      const { data: cgProfs } = await adminCg
        .from('profiles').select('id, telegram_chat_id').in('telegram_chat_id', cgIds);
      if (cgProfs?.length) {
        const byUser = new Map(cgProfs.map(p => [p.id, p.telegram_chat_id]));
        const { data: cgMps } = await adminCg
          .from('medical_profiles')
          .select('user_id, avatar_path, share_photo_with_caregivers')
          .in('user_id', cgProfs.map(p => p.id));
        for (const mp of cgMps ?? []) {
          if (!mp.avatar_path || mp.share_photo_with_caregivers === false) continue;
          const tid = byUser.get(mp.user_id);
          if (!tid) continue;
          const { data: signed } = await adminCg.storage
            .from('avatars').createSignedUrl(mp.avatar_path, 600);
          if (signed?.signedUrl) caregiverAvatars[tid] = signed.signedUrl;
        }
      }
    } catch (err) {
      console.error('Failed to resolve caregiver avatars:', err);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-10 font-sans">
      
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" aria-label="Back to dashboard" className="w-11 h-11 shrink-0 flex items-center justify-center hover:bg-muted rounded-xl transition-all border border-transparent hover:border-border text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Users className="w-5 h-5" />
              </div>
              <h1 className="text-2xl font-black tracking-tight text-foreground">Care Circle / Shared Trust</h1>
            </div>
            <p className="text-xs text-muted-foreground font-semibold mt-1">
              Manage who helps support your health journey.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* "Manage Requests" gave no hint that anything was waiting — the page never
              fetched a count. It does now. */}
          <Link
            href="/care-circle/requests"
            className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-xs font-bold bg-card border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-all shadow-sm"
          >
            Manage Requests
            <CountBadge count={pendingRequestCount} label="requests waiting for you" />
          </Link>
          <Link
            href="/care-circle/manage"
            className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-xs font-bold bg-primary-strong hover:bg-primary-strong-hover text-primary-strong-foreground transition-all shadow-sm"
          >
            <Settings className="w-3.5 h-3.5" /> Manage Shared Trust
          </Link>
        </div>
      </div>

      {/* Patient side first, everywhere. This page used to lead with the caregiver role
          while Settings led with the patient role, so the same two lists appeared in
          opposite orders under three different names. */}

      {/* Section A: People Caring For Me */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-black text-foreground uppercase tracking-wider">{CARE_LABELS.asPatient}</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-bold">
            {liveCaringForMe.length}
          </span>
        </div>

        {peopleCaringForMe.length === 0 ? (
          <EmptyState
            className="max-w-lg"
            icon={<Users className="w-6 h-6" />}
            title="No caregivers yet"
            description="A caregiver can see your schedule and gets alerted if you miss a critical dose. Share your connect code to invite one."
            action={{ label: 'Get your connect code', href: '/settings#care-circle' }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {peopleCaringForMe.map((conn) => (
              <div
                key={conn.connection_id}
                className="bg-card border border-border rounded-2xl p-5 flex justify-between items-center shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20 text-sm overflow-hidden">
                    {conn.caregiver_chat_id && caregiverAvatars[conn.caregiver_chat_id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={caregiverAvatars[conn.caregiver_chat_id]} alt="" className="w-full h-full object-cover" />
                    ) : (
                    conn.resolved_name?.substring(0, 2).toUpperCase() || 'CG'
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground text-sm">{conn.resolved_name}</h3>
                    {/* A caregiver's name, so the stored value reads correctly as-is. */}
                    <p className="text-[11px] text-muted-foreground font-semibold mt-0.5">{caregiverRoleLabel(conn.relationship_type)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Was hardcoded success-green, so a PENDING link showed up as a green
                      "PENDING" pill — the badge said the opposite of the word inside it. */}
                  <Badge tone={isLiveConnection(conn) ? 'success' : isPendingConnection(conn) ? 'warning' : 'neutral'}>
                    {conn.connection_status}
                  </Badge>
                  <Link
                    href="/care-circle/manage"
                    className="w-11 h-11 flex items-center justify-center hover:bg-muted rounded-xl text-muted-foreground hover:text-foreground border border-transparent hover:border-border transition-all"
                    title="Manage Shared Trust"
                    aria-label={`Manage what ${conn.resolved_name} can see`}
                  >
                    <Settings className="w-4 h-4" />
                  </Link>
                  <CaregiverConnectionActions
                    connectionId={conn.connection_id}
                    caregiverName={conn.resolved_name || 'this caregiver'}
                    source={sourceOf(conn.is_migrated)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section B: People I Care For */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-black text-foreground uppercase tracking-wider">{CARE_LABELS.asCaregiver}</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-bold">
            {liveICareFor.length}
          </span>
        </div>

        {peopleICareFor.length === 0 ? (
          <EmptyState
            className="max-w-lg"
            icon={<Link2 className="w-6 h-6" />}
            title="Not caring for anyone yet"
            description="When someone adds you as their caregiver, their request appears here for you to accept."
            action={{ label: 'Check requests', href: '/care-circle/requests' }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {peopleICareFor.map((conn) => (
              /* `relationship` here describes a PATIENT, so the stored caregiver role has
                 to be inverted. Raw, it printed "Pratap · SON" — tagging the patient with
                 the caregiver's own role — while the dashboard said "Parent" for the same
                 person. One field, opposite meanings by side of the link. */
              <PatientStatusCard
                key={conn.connection_id}
                id={conn.connection_id}
                name={conn.resolved_name || 'Patient'}
                relationship={patientRoleLabel(conn.relationship_type)}
                isPrimary={conn.is_primary}
                telegramId={conn.patient_telegram_id || ''}
                status={conn.connection_status}
                source={sourceOf(conn.is_migrated)}
                userId={userData.user.id}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
