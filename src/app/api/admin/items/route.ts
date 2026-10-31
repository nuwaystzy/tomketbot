import { NextResponse } from 'next/server';
import { requireDashboardAuth } from '@/lib/dashboardAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const statuses = new Set(['pending', 'approved', 'skipped', 'posted']);

export async function GET(request: Request) {
  if (!await requireDashboardAuth()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const status = searchParams.get('status');
  const category = searchParams.get('category');
  const q = (searchParams.get('q') || '').trim().slice(0, 100);
  let query = supabaseAdmin.from('parsed_items').select('id, display_id, title_for_list, project_name, category, status, source_link, telegram_post_date, confidence, original_text', { count: 'exact' }).order('telegram_post_date', { ascending: false }).limit(200);
  if (start) query = query.gte('telegram_post_date', `${start}T00:00:00+07:00`);
  if (end) query = query.lte('telegram_post_date', `${end}T23:59:59+07:00`);
  if (status && statuses.has(status)) query = query.eq('status', status);
  if (category) query = query.eq('category', category);
  if (q) query = query.or(`title_for_list.ilike.%${q}%,project_name.ilike.%${q}%`);
  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [], total: count || 0, capped: (count || 0) > 200 });
}

export async function POST(request: Request) {
  if (!await requireDashboardAuth()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.title !== 'string' || !body.title.trim() || typeof body.category !== 'string' || typeof body.sourceLink !== 'string' || !/^https?:\/\//.test(body.sourceLink)) return NextResponse.json({ error: 'Isi title, kategori, dan link valid.' }, { status: 400 });
  const now = body.telegramPostDate || new Date().toISOString();
  const item = { source_channel: 'dashboard_manual', message_id: Date.now(), source_link: body.sourceLink, original_text: body.title.trim(), category: body.category, project_name: body.title.trim(), title_for_list: body.title.trim(), summary: 'Manual dashboard entry', action: 'Manual entry', confidence: 1, status: body.status === 'approved' ? 'approved' : 'pending', reason: 'Manually added from dashboard', telegram_post_date: now };
  const { data, error } = await supabaseAdmin.from('parsed_items').insert(item).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabaseAdmin.from('action_logs').insert({ admin_id: 0, action_type: 'dashboard_add', target_item_id: data.id, previous_state: {}, new_state: item });
  return NextResponse.json({ item: data });
}
