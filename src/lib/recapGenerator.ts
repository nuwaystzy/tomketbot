import { DatabaseParsedItem } from '@/types';
import { CATEGORIES, CATEGORY_KEYS, getCategoryLabel } from './categories';
import { supabaseAdmin } from './supabaseAdmin';

export const generateRecapDraft = async (startDateStr: string, endDateStr: string): Promise<string> => {
  // Query Supabase for approved items within the date range based on telegram_post_date
  // We'll use >= startDate and <= endDate 23:59:59
  
  const endDateTime = `${endDateStr}T23:59:59.999Z`;
  
  const { data, error } = await supabaseAdmin
    .from('parsed_items')
    .select('*')
    .eq('status', 'approved')
    .gte('telegram_post_date', `${startDateStr}T00:00:00.000Z`)
    .lte('telegram_post_date', endDateTime)
    .order('telegram_post_date', { ascending: true });

  if (error) {
    console.error('Error fetching items for recap:', error);
    return `Error generating recap: ${error.message}`;
  }

  const items = (data || []) as DatabaseParsedItem[];

  if (items.length === 0) {
    return `No approved items found between ${startDateStr} and ${endDateStr}.`;
  }

  // Format the dates
  const startObj = new Date(startDateStr);
  const endObj = new Date(endDateStr);
  
  const startDay = startObj.getDate();
  const endDay = endObj.getDate();
  const monthNames = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  const month = monthNames[startObj.getMonth()]; // Assuming same month for simplicity as per requirement "1-5 MAY"

  let dateHeader = `${startDay}-${endDay} ${month}`;
  if (startDay === endDay) {
    dateHeader = `${startDay} ${month}`;
  }

  let recapText = `📢 LIST AIRDROP ${dateHeader}\n\n`;

  // Group items by category following the CATEGORY_KEYS order
  const groupedItems: Record<string, DatabaseParsedItem[]> = {};
  
  items.forEach(item => {
    if (!groupedItems[item.category]) {
      groupedItems[item.category] = [];
    }
    groupedItems[item.category].push(item);
  });

  for (const catKey of CATEGORY_KEYS) {
    if (groupedItems[catKey] && groupedItems[catKey].length > 0) {
      recapText += `▫️ ${getCategoryLabel(catKey)}\n`;
      groupedItems[catKey].forEach(item => {
        recapText += `➖ <a href="${item.source_link}">${item.title_for_list}</a>\n`;
      });
      recapText += '\n';
    }
  }

  // Add footer
  recapText += `🔗 PREVIOUS LIST\n`;
  recapText += `📱 <a href="https://t.me/+n2dN5qK7RqlhYzk1">DISCUSSION GRUB</a>\n`;
  recapText += `📱 <a href="https://x.com/TomketLovers">TWITTER</a>\n`;

  return recapText;
};
