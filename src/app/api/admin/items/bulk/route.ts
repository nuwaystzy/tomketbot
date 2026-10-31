import { NextResponse } from 'next/server';
import { requireDashboardAuth } from '@/lib/dashboardAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const validActions = new Set(['approved', 'skipped', 'delete']);

export async function POST(request: Request) {
  if (!await requireDashboardAuth()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.ids) || body.ids.length === 0 || !validActions.has(body.action)) {
    return NextResponse.json({ error: 'Pilih minimal satu item dan aksi yang valid.' }, { status: 400 });
  }

  const ids = body.ids.filter((id: unknown) => typeof id === 'string') as string[];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ID tidak valid.' }, { status: 400 });
  }

  if (body.action === 'delete') {
    const { error } = await supabaseAdmin.from('parsed_items').delete().in('id', ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await supabaseAdmin.from('action_logs').insert({
      admin_id: 0,
      action_type: 'dashboard_bulk_delete',
      target_item_id: null,
      previous_state: { ids },
      new_state: {},
    });
    return NextResponse.json({ ok: true, count: ids.length });
  }

  const newStatus = body.action;
  const { error } = await supabaseAdmin
    .from('parsed_items')
    .update({ status: newStatus })
    .in('id', ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('action_logs').insert({
    admin_id: 0,
    action_type: `dashboard_bulk_${newStatus}`,
    target_item_id: null,
    previous_state: { ids },
    new_state: { status: newStatus },
  });

  return NextResponse.json({ ok: true, count: ids.length });
}
