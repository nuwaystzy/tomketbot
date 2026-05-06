const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(k + '=(.+?)(?=\n|$)'))[1].trim();
const supabase = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

// All items visible in the screenshot that have been shared to channel
// These are identified by their title_for_list names
const sharedTitles = [
  // AIRDROP/CAMPAIGN
  'Clasho', 'Frunk Airdrop', 'Minati Exchange', 'Numo', 'Fluent',
  'Point Exchange', 'Teqoin Wallet', 'USE Exchange', 'YOM Season 2',
  'RealGo', 'Gamee', 'Dlicom Wallet FCFS', 'Goldfish Educational Quiz',
  // WL/EARLY ACCESS
  'Dogskullz', 'Stupid Faces WL', 'The Headcase Collective WL',
  'Liquid Frog Waitlist NFT', 'Nasbela Whitelist', 'Keeds whitelist NFT',
  'Chronos Whitelist', 'Headcase Store', 'Jule Waitlist', 'Slimez Waitlist Nft',
  // CLAIM/CHECK ELIGIBLE
  'Memecore', 'Yom s1', 'Bill', 'Antfun', 'Farcaster Claim', 'DAC Inception Faucet',
  // UPDATE
  'Xenea', 'HUMN', 'Krain', 'Forte'
];

async function markShared() {
  // First, check current state
  const { data: items, error } = await supabase
    .from('parsed_items')
    .select('id, display_id, title_for_list, weekly_shared')
    .eq('status', 'approved')
    .order('display_id');

  if (error) {
    console.error('Error fetching items:', error);
    return;
  }

  console.log('Total approved items found:', items.length);

  // Create a batch record
  const batchId = 'WEEK-2026-05-06-001';
  const now = new Date().toISOString();

  // Find matching items (case-insensitive partial match)
  const matchedItems = items.filter(item => {
    const title = (item.title_for_list || '').toLowerCase();
    return sharedTitles.some(t => title.includes(t.toLowerCase()) || t.toLowerCase().includes(title));
  });

  console.log('\nMatched items to mark as shared:');
  matchedItems.forEach(i => console.log(`  [${i.display_id}] ${i.title_for_list} (currently weekly_shared=${i.weekly_shared})`));

  const matchedIds = matchedItems.map(i => i.id);

  if (matchedIds.length === 0) {
    console.log('\nNo items matched! Checking all approved items...');
    items.forEach(i => console.log(`  [${i.display_id}] ${i.title_for_list}`));
    return;
  }

  console.log(`\nMarking ${matchedIds.length} items as weekly_shared=true with batch ID: ${batchId}`);

  // Insert batch record into weekly_recaps
  const { error: batchError } = await supabase.from('weekly_recaps').insert({
    batch_id: batchId,
    channel_id: process.env.TELEGRAM_RECAP_CHANNEL_ID || 'manual',
    message_id: null,
    total_items: matchedIds.length,
    item_ids: matchedIds,
  });

  if (batchError) {
    if (batchError.code === '42P01') {
      console.log('⚠️  weekly_recaps table does not exist yet. Please run the SQL migration first.');
      console.log('Proceeding to update items without batch record...');
    } else {
      console.error('Error inserting batch record:', batchError);
    }
  } else {
    console.log(`✅ Batch record created: ${batchId}`);
  }

  // Update all matched items
  const { error: updateError, data: updated } = await supabase
    .from('parsed_items')
    .update({
      weekly_shared: true,
      weekly_shared_at: now,
      weekly_batch_id: batchId,
    })
    .in('id', matchedIds)
    .select('display_id, title_for_list');

  if (updateError) {
    if (updateError.code === '42703') {
      console.log('⚠️  weekly_shared column does not exist yet. Please run the SQL migration first!');
      console.log('Migration file: supabase/migrations/weekly_sharing.sql');
    } else {
      console.error('Error updating items:', updateError);
    }
    return;
  }

  console.log(`\n✅ Successfully marked ${updated?.length || 0} items as weekly_shared=true:`);
  updated?.forEach(i => console.log(`  ✓ [${i.display_id}] ${i.title_for_list}`));

  // Also check for any remaining items NOT matched
  const notMatched = items.filter(i => !matchedIds.includes(i.id));
  if (notMatched.length > 0) {
    console.log(`\n📋 ${notMatched.length} items still weekly_shared=false:`);
    notMatched.forEach(i => console.log(`  - [${i.display_id}] ${i.title_for_list}`));
  }
}

markShared().catch(console.error);
