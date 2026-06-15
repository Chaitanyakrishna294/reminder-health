import React from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import MedicationReviewQueue from '@/components/dashboard/medication-review-queue';
import MedicalCard from '@/components/medical/medical-card';
import { 
  getActiveConnectionForPatient, 
  getPatientHealthMetrics, 
  CareCircleConnection,
  PatientHealthMetrics
} from '@/lib/supabase/care-circle-service';
import { createClient } from '@/lib/supabase/server';
import moment from 'moment-timezone';
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  ShieldAlert, 
  Heart, 
  Eye, 
  EyeOff, 
  FolderLock, 
  BarChart3, 
  Package, 
  CheckCircle,
  FileText,
  Lock,
  Plus,
  UserCheck
} from 'lucide-react';

export const revalidate = 0; // Dynamic rendering

interface PageProps {
  params: Promise<{
    patientId: string;
  }>;
}

// 1. Health Story Generator Component/Helper
function generateHealthStory(
  patientName: string,
  relationshipType: string,
  metrics: PatientHealthMetrics
): { story: string; detail: string; type: 'success' | 'warning' | 'danger' | 'info' } {
  const rel = relationshipType.toUpperCase();
  const titleRel = relationshipType.charAt(0).toUpperCase() + relationshipType.slice(1).toLowerCase();

  // Scenario 1: Missed doses today (High Priority Intervention)
  if (metrics.missedDosesCountToday > 0) {
    return {
      story: `${titleRel} missed their scheduled medication today.`,
      detail: `Consider checking in on ${patientName} to verify if they took their doses or if they need support.`,
      type: 'danger'
    };
  }

  // Scenario 2: Low medication stock (Refill Warning)
  if (metrics.minStockDaysRemaining > 0 && metrics.minStockDaysRemaining <= 3) {
    return {
      story: `${titleRel} may need a refill within 3 days.`,
      detail: `Their lowest medication stock level has dropped to ${metrics.minStockDaysRemaining} days remaining.`,
      type: 'warning'
    };
  }

  // Scenario 3: Highly compliant and stable
  if (metrics.adherenceRate >= 90) {
    return {
      story: `${titleRel} is doing well today.`,
      detail: `They have taken all scheduled doses on track today. Adherence is stable at ${metrics.adherenceRate}% over the last 30 days.`,
      type: 'success'
    };
  }

  // Scenario 4: Standard stable check-in
  return {
    story: `${titleRel} is on track with their medications today.`,
    detail: `All scheduled doses are logged successfully. Adherence is currently at ${metrics.adherenceRate}%.`,
    type: 'info'
  };
}

export default async function PatientConsolePage({ params }: PageProps) {
  const { patientId } = await params;
  const userData = await resolveUserData();
  
  if (!userData) {
    redirect('/login');
  }

  const { myTelegramChatId } = userData;

  if (!myTelegramChatId) {
    redirect('/link-account');
  }

  // 2. Fetch connection details and check authorization
  const connection = await getActiveConnectionForPatient(myTelegramChatId, patientId);

  if (!connection || connection.connection_status !== 'ACCEPTED') {
    return (
      <div className="max-w-xl mx-auto mt-12 p-8 bg-card border border-border rounded-3xl text-center space-y-6 shadow-sm">
        <ShieldAlert className="w-12 h-12 mx-auto text-danger" />
        <h2 className="text-xl font-black text-foreground">Access Restricted</h2>
        <p className="text-xs text-muted-foreground">
          You do not have an active caregiver relationship connection with this user, or the link is still pending acceptance.
        </p>
        <div className="pt-4">
          <Link href="/care-circle" className="px-4 py-2.5 bg-primary hover:bg-primary-hover text-xs font-bold rounded-xl text-white transition-all shadow-sm">
            Back to Care Circle
          </Link>
        </div>
      </div>
    );
  }

  // 3. Fetch target patient profile name
  const supabase = await createClient();
  const { data: patientProfile } = await supabase
    .from('profiles')
    .select('id, full_name, created_at')
    .eq('telegram_chat_id', patientId)
    .single();

  const patientName = patientProfile ? patientProfile.full_name || 'Patient' : 'Patient';

  // Calculate connection duration milestone
  const daysConnected = Math.max(1, moment().diff(moment(connection.created_at), 'days'));
  const connectionDate = moment(connection.created_at).format('MMMM YYYY');

  // 4. Fetch patient health snapshot metrics
  const metrics = await getPatientHealthMetrics(patientId);

  // Generate the health story summary
  const healthStory = generateHealthStory(patientName, connection.relationship_type, metrics);

  // Story color styling mapping
  const storyStyles = {
    danger: 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400',
    warning: 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400',
    success: 'bg-success/10 border-success/20 text-success',
    info: 'bg-primary/10 border-primary/20 text-primary'
  }[healthStory.type];

  // 5. Fetch medications and logs if medications permission is true
  let medications: any[] = [];
  let recentLogs: any[] = [];

  if (connection.can_view_medications) {
    const [medsRes, logsRes] = await Promise.all([
      supabase.from('medications').select('*').eq('telegram_id', patientId).eq('active', true),
      supabase.from('reminder_logs').select('id, response, scheduled_time, medications(drug_name)').eq('telegram_id', patientId).order('scheduled_time', { ascending: false }).limit(5)
    ]);
    medications = medsRes.data || [];
    recentLogs = logsRes.data || [];
  }

  // 5b. Medical profile — RLS returns a row ONLY when the patient has granted
  // can_view_medical_profile to this caregiver, so no explicit flag check needed here.
  let medicalProfile: any = null;
  if (patientProfile?.id) {
    const { data: mp } = await supabase
      .from('medical_profiles')
      .select('date_of_birth,gender,blood_group,height_cm,weight_kg,drug_allergies,food_allergies,other_allergies,chronic_conditions,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship')
      .eq('user_id', patientProfile.id)
      .maybeSingle();
    medicalProfile = mp || null;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12 font-sans">
      
      {/* 1. Header Navigation */}
      <div className="flex justify-start">
        <Link href="/care-circle" className="flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground transition-all">
          <ArrowLeft className="w-4 h-4" /> Back to Care Circle
        </Link>
      </div>

      {/* Medical profile (only present when the patient granted permission) */}
      {medicalProfile && (
        <MedicalCard name={patientName} data={medicalProfile} />
      )}

      {/* 2. Relationship Header Card */}
      <div className="bg-card border border-border rounded-3xl p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center font-extrabold border border-primary/20 text-2xl">
            {patientName.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-black text-foreground tracking-tight">{patientName}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-muted-foreground font-semibold">
              <span className="capitalize">{connection.relationship_type.toLowerCase()}</span>
              <span>•</span>
              <span>{connection.is_primary ? 'Primary Care Coordinator' : 'Secondary Care Coordinator'}</span>
              <span>•</span>
              <span className="text-primary font-bold">Caring together for {daysConnected} days</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-muted/60 border border-border px-4 py-3 rounded-2xl">
          <div className="h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
          <div className="text-xs">
            <p className="text-muted-foreground font-bold">Monitoring Status</p>
            <p className="text-foreground font-extrabold mt-0.5">Active</p>
          </div>
        </div>
      </div>

      {/* 3. Narrative-First Health Story Card */}
      <div className={`p-6 border rounded-3xl shadow-sm flex flex-col gap-2.5 ${storyStyles}`}>
        <div className="flex items-center gap-2">
          {healthStory.type === 'danger' && <ShieldAlert className="w-5 h-5 text-danger" />}
          {healthStory.type === 'warning' && <Package className="w-5 h-5 text-warning" />}
          {healthStory.type === 'success' && <CheckCircle className="w-5 h-5 text-success" />}
          {healthStory.type === 'info' && <Clock className="w-5 h-5 text-primary" />}
          <h2 className="text-base font-black tracking-tight">{healthStory.story}</h2>
        </div>
        <p className="text-xs text-foreground font-medium opacity-90 leading-relaxed">
          {healthStory.detail}
        </p>
      </div>

      {/* 4. Metrics Grid (Available below the narrative summary) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Adherence Rate */}
        <div className="bg-card border border-border rounded-2xl p-5 flex flex-col justify-between shadow-sm">
          <div>
            <span className="text-[10px] text-muted-foreground font-bold tracking-wider uppercase">30d Adherence</span>
            <h3 className="text-3xl font-extrabold text-foreground mt-1.5">{metrics.adherenceRate}%</h3>
          </div>
          <div className="text-[10px] text-primary font-bold mt-3 flex items-center gap-1.5 bg-primary/10 px-2 py-1 rounded-md w-max border border-primary/20">
            <Heart className="w-3.5 h-3.5" /> Adherence Score
          </div>
        </div>

        {/* Active Medications */}
        <div className="bg-card border border-border rounded-2xl p-5 flex flex-col justify-between shadow-sm">
          <div>
            <span className="text-[10px] text-muted-foreground font-bold tracking-wider uppercase">Active Medications</span>
            <h3 className="text-3xl font-extrabold text-foreground mt-1.5">{metrics.activeMedicationsCount}</h3>
          </div>
          <div className="text-[10px] text-muted-foreground font-bold mt-3 flex items-center gap-1.5 bg-muted px-2 py-1 rounded-md w-max border border-border">
            <Clock className="w-3.5 h-3.5" /> Active Prescriptions
          </div>
        </div>

        {/* Stock Status */}
        <div className="bg-card border border-border rounded-2xl p-5 flex flex-col justify-between shadow-sm">
          <div>
            <span className="text-[10px] text-muted-foreground font-bold tracking-wider uppercase">Lowest Stock</span>
            <h3 className="text-3xl font-extrabold text-foreground mt-1.5">{metrics.minStockDaysRemaining} Days</h3>
          </div>
          <div className={`text-[10px] font-bold mt-3 flex items-center gap-1.5 px-2 py-1 rounded-md w-max border ${
            metrics.minStockDaysRemaining <= 3 
              ? 'text-danger bg-danger/10 border-danger/20' 
              : 'text-muted-foreground bg-muted border-border'
          }`}>
            <Package className="w-3.5 h-3.5" /> Refill Remaining
          </div>
        </div>

        {/* Missed Doses */}
        <div className="bg-card border border-border rounded-2xl p-5 flex flex-col justify-between shadow-sm">
          <div>
            <span className="text-[10px] text-muted-foreground font-bold tracking-wider uppercase">Missed Doses Today</span>
            <h3 className="text-3xl font-extrabold text-foreground mt-1.5">{metrics.missedDosesCountToday}</h3>
          </div>
          <div className={`text-[10px] font-bold mt-3 flex items-center gap-1.5 px-2 py-1 rounded-md w-max border ${
            metrics.missedDosesCountToday > 0 
              ? 'text-danger bg-danger/10 border-danger/20' 
              : 'text-success bg-success/10 border-success/20'
          }`}>
            <CheckCircle className="w-3.5 h-3.5" /> Status check
          </div>
        </div>

      </div>

      {/* Main Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Relationship Permissions & Health Score */}
        <div className="space-y-6 lg:col-span-1">
          
          {/* Routine Stability Card */}
          <div className="bg-card border border-border rounded-3xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-black text-foreground uppercase tracking-wider">Routine Stability</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-black text-foreground">{metrics.relationshipHealthScore}</span>
              <span className="text-muted-foreground font-bold">/ 100</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all" 
                style={{ width: `${metrics.relationshipHealthScore}%` }} 
              />
            </div>
            <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">
              Based on adherence logs, stock levels, and missed doses over the last 30 days.
            </p>
          </div>

          {/* Caregiving Milestones Card */}
          <div className="bg-card border border-border rounded-3xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-black text-foreground uppercase tracking-wider">Caregiving Milestones</h3>
            <div className="space-y-3 text-xs text-foreground font-medium">
              <div className="flex justify-between items-center py-1.5 border-b border-border">
                <span className="text-muted-foreground">Relation</span>
                <span className="font-bold capitalize">{connection.relationship_type.toLowerCase()}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-border">
                <span className="text-muted-foreground">Role</span>
                <span className="font-bold">{connection.is_primary ? 'Primary Care Coordinator' : 'Secondary Coordinator'}</span>
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="text-muted-foreground">Longevity</span>
                <span className="font-bold">Caring together since {connectionDate}</span>
              </div>
            </div>
          </div>

          {/* Relationship Permissions (Trust-Oriented Copy) */}
          <div className="bg-card border border-border rounded-3xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-black text-foreground uppercase tracking-wider">Shared Trust</h3>
            
            <div className="space-y-3 text-xs text-foreground font-medium">
              <div className="flex items-start gap-2.5">
                {connection.can_view_medications ? (
                  <span className="text-success font-black text-sm shrink-0">✓</span>
                ) : (
                  <span className="text-muted-foreground font-black text-sm shrink-0">✕</span>
                )}
                <p className={connection.can_view_medications ? 'text-foreground' : 'text-muted-foreground opacity-60'}>
                  {patientName} has shared their medication schedule with you.
                </p>
              </div>

              <div className="flex items-start gap-2.5">
                {connection.can_view_reports ? (
                  <span className="text-success font-black text-sm shrink-0">✓</span>
                ) : (
                  <span className="text-muted-foreground font-black text-sm shrink-0">✕</span>
                )}
                <p className={connection.can_view_reports ? 'text-foreground' : 'text-muted-foreground opacity-60'}>
                  {patientName} has shared their compliance reports with you.
                </p>
              </div>

              <div className="flex items-start gap-2.5">
                {connection.can_view_vault ? (
                  <span className="text-success font-black text-sm shrink-0">✓</span>
                ) : (
                  <span className="text-muted-foreground font-black text-sm shrink-0">✕</span>
                )}
                <p className={connection.can_view_vault ? 'text-foreground' : 'text-muted-foreground opacity-60'}>
                  {patientName} has shared their health documents vault with you.
                </p>
              </div>

              <div className="flex items-start gap-2.5">
                {connection.can_edit_medications ? (
                  <span className="text-success font-black text-sm shrink-0">✓</span>
                ) : (
                  <span className="text-muted-foreground font-black text-sm shrink-0">✕</span>
                )}
                <p className={connection.can_edit_medications ? 'text-foreground' : 'text-muted-foreground opacity-60'}>
                  {connection.can_edit_medications 
                    ? `You are authorized to edit ${patientName}'s medication schedule.` 
                    : `You have read-only access to ${patientName}'s medication schedule.`}
                </p>
              </div>
            </div>
          </div>

        </div>

        {/* Right Side: Permission-Aware Data Views */}
        <div className="lg:col-span-2 space-y-6">
          
          <MedicationReviewQueue 
            patientTelegramChatId={patientId}
            userRole="CAREGIVER"
          />

          {/* Medications schedule card */}
          <div className="bg-card border border-border rounded-3xl p-6 space-y-4 shadow-sm">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" /> Schedule List
              </h3>
              {connection.can_edit_medications && (
                <button className="flex items-center gap-1 px-2.5 py-1 rounded bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold hover:bg-primary/20 transition-all">
                  <Plus className="w-3.5 h-3.5" /> Add Medication
                </button>
              )}
            </div>

            {!connection.can_view_medications ? (
              <div className="py-10 text-center space-y-2.5 bg-muted/40 rounded-2xl border border-border p-4">
                <Lock className="w-8 h-8 mx-auto text-muted-foreground opacity-60" />
                <p className="text-xs text-foreground font-bold">
                  {patientName} has chosen not to share medication schedules.
                </p>
              </div>
            ) : medications.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No active medications scheduled today.</p>
            ) : (
              <div className="divide-y divide-border text-xs">
                {medications.map((med) => (
                  <div key={med.id} className="py-3 flex justify-between items-center first:pt-0 last:pb-0">
                    <div>
                      <p className="font-extrabold text-foreground">{med.drug_name}</p>
                      <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">{med.dosage} • {med.frequency.replace('_', ' ')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-foreground font-semibold">{med.tablet_count !== null ? `${med.tablet_count} Left` : 'Unlimited'}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5 font-bold">Priority: {med.priority_level}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Adherence log card */}
          <div className="bg-card border border-border rounded-3xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" /> Recent Compliance Logs
            </h3>

            {!connection.can_view_reports ? (
              <div className="py-10 text-center space-y-2.5 bg-muted/40 rounded-2xl border border-border p-4">
                <EyeOff className="w-8 h-8 mx-auto text-muted-foreground opacity-60" />
                <p className="text-xs text-foreground font-bold">
                  This information has not been shared with you.
                </p>
              </div>
            ) : recentLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No compliance logs registered in the last 7 days.</p>
            ) : (
              <div className="divide-y divide-border text-xs">
                {recentLogs.map((log) => {
                  const isTaken = log.response === 'TAKEN';
                  const isSkip = log.response === 'SKIP';
                  
                  return (
                    <div key={log.id} className="py-3 flex justify-between items-center first:pt-0 last:pb-0">
                      <div>
                        <p className="font-extrabold text-foreground">
                          {Array.isArray(log.medications) ? log.medications[0]?.drug_name : log.medications?.drug_name || 'Medication'}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">
                          Scheduled: {moment(log.scheduled_time).tz('Asia/Kolkata').format('lll')}
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        isTaken 
                          ? 'bg-success/10 text-success border border-success/20' 
                          : isSkip 
                          ? 'bg-warning/10 text-warning border border-warning/20' 
                          : 'bg-danger/10 text-danger border border-danger/20'
                      }`}>
                        {log.response}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Health Vault Documents Card */}
          <div className="bg-card border border-border rounded-3xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Documents Shared by {patientName}
            </h3>

            {!connection.can_view_vault ? (
              <div className="py-10 text-center space-y-2.5 bg-muted/40 rounded-2xl border border-border p-4">
                <FolderLock className="w-8 h-8 mx-auto text-muted-foreground opacity-60" />
                <p className="text-xs text-foreground font-bold">
                  {patientName} has chosen not to share health documents.
                </p>
                <p className="text-[10px] text-muted-foreground max-w-xs mx-auto leading-relaxed">
                  Prescriptions, scan images, and laboratory reports will become visible here once shared.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {['Prescriptions', 'Lab Reports', 'Scans', 'Discharge'].map((folder) => (
                  <Link
                    key={folder}
                    href={`/health-vault?patientId=${patientProfile?.id}`}
                    className="bg-muted/40 border border-border rounded-2xl p-4 flex flex-col justify-between hover:border-primary/45 hover:bg-muted/60 transition-all shadow-sm group"
                  >
                    <div>
                      <FileText className="w-6 h-6 text-primary group-hover:scale-105 transition-transform" />
                      <h4 className="font-bold text-foreground text-xs mt-3">{folder}</h4>
                    </div>
                    <span className="text-[9px] text-primary mt-2 font-bold flex items-center gap-1">
                      <span>View Folder</span>
                      <span className="opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">→</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}
