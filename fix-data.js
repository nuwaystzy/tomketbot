const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(k + '=(.+?)(?=\n|$)'))[1].trim();
const supabase = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const cleanProjectName = (name) => {
  if (!name) return 'Unknown';
  // Remove emojis
  let clean = name.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
  // Remove common punctuation artifacts at end
  clean = clean.replace(/\.$/, '').trim();
  // Remove multiple spaces
  clean = clean.replace(/\s+/g, ' ');
  // Limit to max 4 words
  const words = clean.split(' ').filter(w => w.length > 0);
  if (words.length > 4) clean = words.slice(0, 4).join(' ');
  else clean = words.join(' ');
  return clean || 'Unknown';
};

// Manual overrides for specific IDs seen in the data
const OVERRIDES = {
  61: { title_for_list: 'Stabilizer Update', project_name: 'Stabilizer', category: 'UPDATE' },
  62: { title_for_list: 'NEXUS Testnet Reset', project_name: 'NEXUS Testnet', category: 'TESTNET' },
  59: { title_for_list: 'Mawari Mainnet', project_name: 'Mawari', category: 'MAINNET' },
  60: { title_for_list: 'Raven Market Rewards', project_name: 'Raven Market', category: 'CLAIM_CHECK_ELIGIBLE' },
};

async function fixAllData() {
  // Fix ALL approved items (both shared and unshared)
  const { data: items, error } = await supabase
    .from('parsed_items')
    .select('id, display_id, title_for_list, project_name, category')
    .eq('status', 'approved');

  if (error) {
    console.error('Error fetching items:', error);
    return;
  }

  console.log(`Found ${items.length} approved items to check...\n`);
  let fixedCount = 0;

  for (const item of items) {
    let updates = {};

    // Apply manual overrides first
    if (OVERRIDES[item.display_id]) {
      const o = OVERRIDES[item.display_id];
      if (o.title_for_list !== item.title_for_list) updates.title_for_list = o.title_for_list;
      if (o.project_name !== item.project_name) updates.project_name = o.project_name;
      if (o.category !== item.category) updates.category = o.category;
    } else {
      // Auto-clean
      const newTitle = cleanProjectName(item.title_for_list);
      const newName = cleanProjectName(item.project_name);

      if (newTitle !== item.title_for_list) updates.title_for_list = newTitle;
      if (newName !== item.project_name) updates.project_name = newName;
    }

    if (Object.keys(updates).length > 0) {
      console.log(`[ID:${item.display_id}] ${item.title_for_list}`);
      Object.entries(updates).forEach(([k, v]) => console.log(`  ${k}: '${item[k]}' -> '${v}'`));

      const { error: updateError } = await supabase
        .from('parsed_items')
        .update(updates)
        .eq('id', item.id);

      if (updateError) console.error(`  ERROR:`, updateError.message);
      else fixedCount++;
    }
  }

  console.log(`\nDone! Fixed ${fixedCount} items.`);
}

fixAllData().catch(console.error);
