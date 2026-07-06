// Shared option/step data for the medication wizard, used by both the "new" and
// "edit" forms. These arrays were previously copy-pasted identically in both pages;
// the two pages still own their own markup and styling (which have intentionally
// diverged), so only this presentation-neutral data is shared here.

import React from 'react';
import {
  Pill,
  Clock,
  Layers,
  ShieldAlert,
  Beaker,
  Droplets,
  Syringe,
  Wind,
  Package,
  Bandage,
  Sun,
  CloudSun,
  Moon,
  ShieldCheck,
  AlertTriangle,
  CircleAlert,
  ClipboardList,
} from 'lucide-react';
import { SpoonIcon, CreamBottleIcon, TabletIcon } from '@/components/ui/custom-icons';

export type UnitType =
  | 'TABLET'
  | 'CAPSULE'
  | 'ML'
  | 'DROP'
  | 'APPLICATION'
  | 'TEASPOON'
  | 'UNIT'
  | 'PATCH'
  | 'INHALATION'
  | 'OTHER';

export interface UnitOption {
  id: UnitType;
  label: string;
  icon: React.ReactNode;
}

export const unitOptions: UnitOption[] = [
  { id: 'TABLET', label: 'Tablet', icon: <TabletIcon className="w-5 h-5" /> },
  { id: 'CAPSULE', label: 'Capsule', icon: <Pill className="w-5 h-5" /> },
  { id: 'ML', label: 'Milliliter (ml)', icon: <Beaker className="w-5 h-5" /> },
  { id: 'DROP', label: 'Drop', icon: <Droplets className="w-5 h-5" /> },
  { id: 'APPLICATION', label: 'Application', icon: <CreamBottleIcon className="w-5 h-5" /> },
  { id: 'TEASPOON', label: 'Teaspoon', icon: <SpoonIcon className="w-5 h-5" /> },
  { id: 'UNIT', label: 'Unit', icon: <Syringe className="w-5 h-5" /> },
  { id: 'PATCH', label: 'Patch', icon: <Bandage className="w-5 h-5" /> },
  { id: 'INHALATION', label: 'Inhalation', icon: <Wind className="w-5 h-5" /> },
  { id: 'OTHER', label: 'Other', icon: <Package className="w-5 h-5" /> },
];

// Step metadata for the premium stepper.
export const stepMeta = [
  { label: 'Details', icon: <Pill className="w-4 h-4" /> },
  { label: 'Schedule', icon: <Clock className="w-4 h-4" /> },
  { label: 'Dosage', icon: <Beaker className="w-4 h-4" /> },
  { label: 'Inventory', icon: <Layers className="w-4 h-4" /> },
  { label: 'Priority', icon: <ShieldAlert className="w-4 h-4" /> },
  { label: 'Review', icon: <ClipboardList className="w-4 h-4" /> },
];

export const frequencies = [
  { id: 'once_daily', title: 'Once Daily', desc: 'One dose per day', icon: <Sun className="w-5 h-5" /> },
  { id: 'twice_daily', title: 'Twice Daily', desc: 'Morning and night', icon: <CloudSun className="w-5 h-5" /> },
  { id: 'thrice_daily', title: 'Thrice Daily', desc: 'Morning, noon, and night', icon: <Moon className="w-5 h-5" /> },
];

export const priorities = [
  { id: 'normal', title: 'Normal', desc: 'General vitamins and supplements', icon: <ShieldCheck className="w-5 h-5" />, color: 'success' as const },
  { id: 'important', title: 'Important', desc: 'Core medication, low delay tolerated', icon: <AlertTriangle className="w-5 h-5" />, color: 'warning' as const },
  { id: 'critical', title: 'Critical', desc: 'Life-critical doses, alarms caregiver on miss', icon: <CircleAlert className="w-5 h-5" />, color: 'danger' as const },
];
