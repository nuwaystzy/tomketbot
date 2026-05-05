const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const getVal = (key) => envFile.match(new RegExp(`${key}=(.+)`))[1].trim();

const supabase = createClient(getVal('SUPABASE_URL'), getVal('SUPABASE_SERVICE_ROLE_KEY'));

async function fix() {
  // Update Xenea to its actual post date: May 1, 2026
  const { data, error } = await supabase
    .from('parsed_items')
    .update({ telegram_post_date: '2026-05-01T07:52:00.000Z' })
    .ilike('project_name', '%xenea%')
    .select();
  
  if (error) console.error(error);
  else console.log('Updated:', data.map(i => `${i.project_name} -> ${i.telegram_post_date}`));
}

fix();
