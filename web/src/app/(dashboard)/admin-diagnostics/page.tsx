import { notFound } from 'next/navigation';
import { getAdminUser } from '@/lib/admin';
import AdminDiagnosticsClient from './diagnostics-client';

// Server-side gate: only ADMIN_EMAILS members see this page exists at all.
// The data itself is additionally protected by /api/admin/diagnostics.
export const revalidate = 0;

export default async function AdminDiagnosticsPage() {
  if (!(await getAdminUser())) notFound();
  return <AdminDiagnosticsClient />;
}
