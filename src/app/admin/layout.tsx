import { redirect } from 'next/navigation';
import { requireDashboardAuth } from '@/lib/dashboardAuth';

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!await requireDashboardAuth()) redirect('/admin/login');
  return children;
}
