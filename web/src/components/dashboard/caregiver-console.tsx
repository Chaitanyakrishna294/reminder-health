'use client';

import React from 'react';
import { 
  AlertCircle, 
  AlertTriangle, 
  Users, 
  Phone, 
  Send, 
  Stethoscope, 
  ShieldAlert, 
  Check 
} from 'lucide-react';

interface CaregiverConsoleProps {
  userName: string;
  patientName: string;
  activeEscalations: number;
  todayMissed: number;
  monthlyAdherence: number;
  myTelegramChatId: string;
}

export default function CaregiverConsole({
  userName,
  patientName,
  activeEscalations,
  todayMissed,
  monthlyAdherence,
  myTelegramChatId,
}: CaregiverConsoleProps) {
  return (
    <div className="space-y-8 w-full mt-6">
      {/* Caregiver Command Center Alarm Banner */}
      {(activeEscalations > 0 || todayMissed > 0) && (
        <div className="bg-card border border-[#FF9FA5] rounded-3xl p-6 md:p-8 shadow-sm relative overflow-hidden animate-red-glow z-40">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
            <div className="space-y-2">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-black bg-danger/20 text-danger border border-[#FF9FA5] animate-pulse">
                <AlertTriangle className="w-4 h-4 text-danger mr-1" /> ACTIVE ALARM
              </span>
              <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">
                Caregiver Command Center
              </h2>
              <p className="text-sm text-[#475569] font-bold">
                Patient <b className="text-[#0F172A]">{patientName}</b> has unanswered reminders. Action is required immediately.
              </p>
              <div className="grid grid-cols-2 gap-4 mt-4 bg-muted p-4 rounded-2xl border border-border max-w-md">
                <div>
                  <p className="text-xs text-muted-foreground font-black">ESCALATED DOSE</p>
                  <p className="text-xl font-extrabold text-danger mt-1">{activeEscalations}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-black">MISSED DOSE</p>
                  <p className="text-xl font-extrabold text-[#475569] mt-1">{todayMissed}</p>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3 w-full lg:w-auto">
              <a
                href={`tel:${myTelegramChatId}`}
                onClick={(e) => {
                  e.preventDefault();
                  alert(`Calling ${patientName}...`);
                }}
                className="flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-primary text-primary-foreground font-extrabold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all shadow-sm cursor-pointer"
              >
                <Phone className="w-4 h-4 shrink-0" /> Call Patient
              </a>
              <a
                href="https://t.me/reminder_health_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-sky-500 text-white font-extrabold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all shadow-sm cursor-pointer"
              >
                <Send className="w-4 h-4 shrink-0" /> Telegram
              </a>
              <button
                onClick={() => alert("Connecting with Doctor...")}
                className="flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-amber-500 text-white font-extrabold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all shadow-sm cursor-pointer"
              >
                <Stethoscope className="w-4 h-4 shrink-0" /> Doctor Contact
              </button>
              <button
                onClick={() => alert("Contacting emergency authorities...")}
                className="flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-danger text-white font-extrabold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all shadow-sm cursor-pointer"
              >
                <ShieldAlert className="w-4 h-4 shrink-0" /> Emergency
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
