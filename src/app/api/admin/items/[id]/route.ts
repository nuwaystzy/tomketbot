import { NextResponse } from 'next/server';
import { requireDashboardAuth } from '@/lib/dashboardAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireDashboardAuth()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const patch = await request.json().catch(() => null);
  if (!patch || !['pending', 'approved', 'skipped', 'posted'].includes(patch.status)) return NextResponse.json({ error: 'Status invalid.' }, { status: 400 });
  const { data: previous } = await supabaseAdmin.from('parsed_items').select('*').eq('id', id).single();
  if (!previous) return NextResponse.json({ error: 'Item tidak ditemukan.' }, { status: 404 });
  const update = { status: patch.status };
  const { data, error } = await supabaseAdmin.from('parsed_items').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabaseAdmin.from('action_logs').insert({ admin_id: 0, action_type: `dashboard_${patch.status}`, target_item_id: id, previous_state: { status: previous.status }, new_state: update });
  return NextResponse.json({ item: data });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireDashboardAuth()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { data: previous } = await supabaseAdmin.from('parsed_items').select('*').eq('id', id).single();
  if (!previous) return NextResponse.json({ error: 'Item tidak ditemukan.' }, { status: 404 });
  const { error } = await supabaseAdmin.from('parsed_items').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabaseAdmin.from('action_logs').insert({ admin_id: 0, action_type: 'dashboard_delete', target_item_id: id, previous_state: previous, new_state: {} });
  return NextResponse.json({ ok: true });
}
