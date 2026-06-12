import React from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import { getCareCircleConnections, getPatientHealthMetrics, PatientHealthMetrics } from '@/lib/supabase/care-circle-service';
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
  UserCheck
} from 'lucide-react';

export const revalidate = 0; // Dynamic, always fresh

interface PatientCardProps {
  id: string;
  name: string;
  relationship: string;
  isPrimary: boolean;
  telegramId: string;
}

async function PatientStatusCard({ id, name, relationship, isPrimary, telegramId }: PatientCardProps) {
  let metrics: PatientHealthMetrics | null = null;
  try {
    metrics = await getPatientHealthMetrics(telegramId);
  } catch (err) {
    console.error(`Failed to load metrics for patient ${telegramId}:`, err);
  }

  const statusLabel = metrics 
    ? metrics.complianceStatus === 'missed' 
      ? '⚠️ Action Needed' 
      : '✓ On Track' 
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
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20">
            {name.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <h3 className="font-black text-foreground text-base tracking-tight">{name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] uppercase font-bold text-muted-foreground">{relationship}</span>
              {isPrimary && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-bold border border-primary/20">
                  Primary
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Health status indicator */}
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusColor}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              metrics?.complianceStatus === 'missed' ? 'bg-danger' : 'bg-success'
            }`} />
            {statusLabel}
          </span>
          {metrics && (
            <span className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
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
            <span className="truncate">{metrics?.nextScheduledDoseTime ? `Dose: ${metrics.nextScheduledDoseTime}` : 'No remaining doses'}</span>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <Link 
          href={`/care-circle/${telegramId}`}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold bg-muted hover:bg-slate-100 text-foreground transition-all border border-border"
        >
          View Health Overview
        </Link>
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
  const { peopleICareFor, peopleCaringForMe } = await getCareCircleConnections(myTelegramChatId);

  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-12 font-sans">
      
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="p-2 hover:bg-muted rounded-xl transition-all border border-transparent hover:border-border text-muted-foreground hover:text-foreground">
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
          <Link 
            href="/care-circle/requests"
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-card border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-all shadow-sm"
          >
            Manage Requests
          </Link>
          <Link 
            href="/care-circle/manage"
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-primary hover:bg-primary/95 text-white transition-all shadow-sm"
          >
            <Settings className="w-3.5 h-3.5" /> Manage Shared Trust
          </Link>
        </div>
      </div>

      {/* Section A: People I Care For */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-black text-foreground uppercase tracking-wider">People I Care For</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-bold">
            {peopleICareFor.length}
          </span>
        </div>

        {peopleICareFor.length === 0 ? (
          <div className="bg-card border border-border rounded-3xl p-10 text-center text-muted-foreground max-w-lg shadow-sm">
            <ShieldAlert className="w-8 h-8 mx-auto text-muted-foreground mb-3 opacity-60" />
            <h3 className="font-bold text-foreground text-sm">No active patients</h3>
            <p className="text-xs mt-1 text-muted-foreground leading-relaxed">
              You are currently not linked as a caregiver for any patient. Ask your patient to share their connection request code using the bot.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {peopleICareFor.map((conn) => (
              <PatientStatusCard 
                key={conn.connection_id}
                id={conn.connection_id}
                name={conn.resolved_name || 'Patient'}
                relationship={conn.relationship_type}
                isPrimary={conn.is_primary}
                telegramId={conn.patient_telegram_id || ''}
              />
            ))}
          </div>
        )}
      </div>

      {/* Section B: People Caring For Me */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-black text-foreground uppercase tracking-wider">People Caring For Me</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-bold">
            {peopleCaringForMe.length}
          </span>
        </div>

        {peopleCaringForMe.length === 0 ? (
          <div className="bg-card border border-border rounded-3xl p-8 text-center text-muted-foreground max-w-lg shadow-sm">
            <h3 className="font-bold text-foreground text-sm">No active caregivers</h3>
            <p className="text-xs mt-1 text-muted-foreground leading-relaxed">
              No one is currently linked to monitor your schedules. You can connect a caregiver under Account Settings to share logs.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {peopleCaringForMe.map((conn) => (
              <div 
                key={conn.connection_id}
                className="bg-card border border-border rounded-2xl p-5 flex justify-between items-center shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20 text-sm">
                    {conn.resolved_name?.substring(0, 2).toUpperCase() || 'CG'}
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground text-sm">{conn.resolved_name}</h3>
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase mt-0.5">{conn.relationship_type}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[9px] px-2 py-0.5 rounded bg-success/10 text-success font-bold border border-success/20 uppercase">
                    {conn.connection_status}
                  </span>
                  <Link 
                    href="/care-circle/manage"
                    className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground border border-transparent hover:border-border transition-all"
                    title="Manage Shared Trust"
                  >
                    <Settings className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
