const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(k + '=(.+?)(?=\n|$)'))[1].trim();
const supabase = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

async function migrate() {
  // Add weekly sharing columns to parsed_items
  const sql1 = `
    ALTER TABLE parsed_items
      ADD COLUMN IF NOT EXISTS weekly_shared BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS weekly_shared_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS weekly_batch_id TEXT;
  `;
  const { error: e1 } = await supabase.rpc('exec_sql', { sql: sql1 });
  if (e1) {
    console.error('Error adding columns:', e1);
  } else {
    console.log('OK: parsed_items columns added');
  }

  // Create weekly_recaps table
  const sql2 = `
    CREATE TABLE IF NOT EXISTS weekly_recaps (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      batch_id TEXT UNIQUE NOT NULL,
      channel_id TEXT,
      message_id TEXT,
      total_items INTEGER DEFAULT 0,
      item_ids TEXT[],
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  const { error: e2 } = await supabase.rpc('exec_sql', { sql: sql2 });
  if (e2) {
    console.error('Error creating weekly_recaps:', e2);
  } else {
    console.log('OK: weekly_recaps table created');
  }
}

migrate().catch(console.error);
