import { DatabaseParsedItem } from '@/types';
import { CATEGORY_KEYS, getCategoryLabel } from './categories';
import { supabaseAdmin } from './supabaseAdmin';
import { escapeHtml } from './telegram';

// ─── Helper: build recap text from items ─────────────────────────────────────

const buildRecapText = (items: DatabaseParsedItem[], dateHeader: string): string => {
  let recapText = `📢 LIST AIRDROP ${dateHeader}\n\n`;

  const groupedItems: Record<string, DatabaseParsedItem[]> = {};
  items.forEach(item => {
    if (!groupedItems[item.category]) groupedItems[item.category] = [];
    groupedItems[item.category].push(item);
  });

  // Print all known category keys in order, then any extras
  const allKeys = [...CATEGORY_KEYS, ...Object.keys(groupedItems).filter(k => !CATEGORY_KEYS.includes(k as any))];
  for (const catKey of allKeys) {
    if (groupedItems[catKey] && groupedItems[catKey].length > 0) {
      recapText += `<b>${getCategoryLabel(catKey)}</b>\n`;
      groupedItems[catKey].forEach(item => {
        recapText += `• <a href="${item.source_link}">${escapeHtml(item.title_for_list || '')}</a>\n`;
      });
      recapText += '\n';
    }
  }

  recapText += `💭 <a href="https://t.me/+n2dN5qK7RqlhYzk1">DISCUSSION GRUB</a>\n`;
  recapText += `🐦 <a href="https://x.com/TomketLovers">TWITTER</a>\n`;

  return recapText;
};

// ─── Date-based recap (for /today and /recap custom date) ────────────────────

export const generateRecapDraft = async (startDateStr: string, endDateStr: string): Promise<string> => {
  const queryStart = `${startDateStr}T00:00:00+07:00`;
  const queryEnd   = `${endDateStr}T23:59:59+07:00`;

  const { data, error } = await supabaseAdmin
    .from('parsed_items')
    .select('*')
    .eq('status', 'approved')
    .gte('telegram_post_date', queryStart)
    .lte('telegram_post_date', queryEnd)
    .order('telegram_post_date', { ascending: true });

  if (error) return `Error generating recap: ${error.message}`;

  const items = (data || []) as DatabaseParsedItem[];
  if (items.length === 0) return `No approved items found between ${startDateStr} and ${endDateStr}.`;

  const getJakartaDateString = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(iso));

  const actualDates = items
    .map(i => i.telegram_post_date ? getJakartaDateString(i.telegram_post_date) : null)
    .filter(Boolean).sort() as string[];

  const effectiveStart = actualDates[0] || startDateStr;
  const effectiveEnd   = actualDates[actualDates.length - 1] || endDateStr;

  const startObj = new Date(effectiveStart + 'T00:00:00Z');
  const endObj   = new Date(effectiveEnd + 'T00:00:00Z');
  const monthNames = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

  const startDay  = startObj.getUTCDate();
  const endDay    = endObj.getUTCDate();
  const month     = monthNames[startObj.getUTCMonth()];
  const endMonth  = monthNames[endObj.getUTCMonth()];

  let dateHeader: string;
  if (effectiveStart === effectiveEnd) dateHeader = `${startDay} ${month}`;
  else if (month === endMonth)         dateHeader = `${startDay}-${endDay} ${month}`;
  else                                 dateHeader = `${startDay} ${month} - ${endDay} ${endMonth}`;

  return buildRecapText(items, dateHeader);
};

// ─── Status-based weekly recap (for /week) ───────────────────────────────────

export interface WeeklyUnsharedResult {
  text: string;
  itemIds: string[];
  totalItems: number;
}

export const generateWeeklyUnsharedDraft = async (excludeIds: string[] = []): Promise<WeeklyUnsharedResult> => {
  const { data, error } = await supabaseAdmin
    .from('parsed_items')
    .select('*')
    .eq('status', 'approved')
    .eq('weekly_shared', false)
    .order('telegram_post_date', { ascending: true });

  if (error) {
    return { text: `Error generating recap: ${error.message}`, itemIds: [], totalItems: 0 };
  }

  // Filter out excluded IDs (items admin removed from this batch session)
  const items = ((data || []) as DatabaseParsedItem[]).filter(i => !excludeIds.includes(i.id || ''));

  if (items.length === 0) {
    return { text: '', itemIds: [], totalItems: 0 };
  }

  // Compute date range header from actual item dates
  const getJakartaDateString = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(iso));

  const dates = items
    .map(i => i.telegram_post_date ? getJakartaDateString(i.telegram_post_date) : null)
    .filter(Boolean).sort() as string[];

  const startObj  = new Date((dates[0] || '2026-01-01') + 'T00:00:00Z');
  const endObj    = new Date((dates[dates.length - 1] || '2026-01-01') + 'T00:00:00Z');
  const monthNames = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

  const startDay  = startObj.getUTCDate();
  const endDay    = endObj.getUTCDate();
  const month     = monthNames[startObj.getUTCMonth()];
  const endMonth  = monthNames[endObj.getUTCMonth()];
  const startDateStr = dates[0] || '';
  const endDateStr   = dates[dates.length - 1] || '';

  let dateHeader: string;
  if (startDateStr === endDateStr) dateHeader = `${startDay} ${month}`;
  else if (month === endMonth)     dateHeader = `${startDay}-${endDay} ${month}`;
  else                             dateHeader = `${startDay} ${month} - ${endDay} ${endMonth}`;

  const itemIds = items.map(i => i.id || '').filter(Boolean);
  return {
    text: buildRecapText(items, dateHeader),
    itemIds,
    totalItems: items.length,
  };
};

// ─── Generate batch ID ───────────────────────────────────────────────────────

export const generateWeeklyBatchId = async (): Promise<string> => {
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  // Count how many batches already exist today
  const { count } = await supabaseAdmin
    .from('weekly_recaps')
    .select('*', { count: 'exact', head: true })
    .like('batch_id', `WEEK-${now}-%`);

  const seq = String((count || 0) + 1).padStart(3, '0');
  return `WEEK-${now}-${seq}`;
};
