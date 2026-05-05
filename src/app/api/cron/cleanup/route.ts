import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';

// Retention policy (in days)
const RETENTION = {
  skipped: 7,      // Skipped items: 7 days
  pending: 14,     // Stale pending: 14 days
  approved: 180,   // Approved items: 6 months (for recap history)
  action_logs: 30, // Action logs: 30 days
};

export async function GET(req: Request) {
  // Simple secret check to prevent unauthorized calls
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, number> = {};

  const cutoff = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  };

  // 1. Delete old skipped items
  const { count: skippedCount } = await supabaseAdmin
    .from('parsed_items')
    .delete({ count: 'exact' })
    .eq('status', 'skipped')
    .lt('created_at', cutoff(RETENTION.skipped));
  results.skipped_deleted = skippedCount || 0;

  // 2. Delete old stale pending items
  const { count: pendingCount } = await supabaseAdmin
    .from('parsed_items')
    .delete({ count: 'exact' })
    .eq('status', 'pending')
    .lt('created_at', cutoff(RETENTION.pending));
  results.pending_deleted = pendingCount || 0;

  // 3. Delete very old approved items
  const { count: approvedCount } = await supabaseAdmin
    .from('parsed_items')
    .delete({ count: 'exact' })
    .eq('status', 'approved')
    .lt('telegram_post_date', cutoff(RETENTION.approved));
  results.approved_deleted = approvedCount || 0;

  // 4. Delete old action logs
  const { count: logCount } = await supabaseAdmin
    .from('action_logs')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff(RETENTION.action_logs));
  results.logs_deleted = logCount || 0;

  // 5. Count remaining
  const { count: totalRemaining } = await supabaseAdmin
    .from('parsed_items')
    .select('*', { count: 'exact', head: true });
  results.total_remaining = totalRemaining || 0;

  console.log('[CLEANUP] Done:', results);
  return NextResponse.json({ ok: true, results, retention: RETENTION });
}
