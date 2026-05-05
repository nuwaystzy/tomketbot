const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const getVal = (key) => envFile.match(new RegExp(`${key}=(.+)`))[1].trim();

const supabase = createClient(getVal('SUPABASE_URL'), getVal('SUPABASE_SERVICE_ROLE_KEY'));

async function check() {
  const { data, error } = await supabase
    .from('parsed_items')
    .select('id, display_id, project_name, category, status, telegram_post_date')
    .eq('status', 'approved')
    .order('telegram_post_date', { ascending: false });
  if (error) console.error(error);
  else data.forEach(i => console.log(`[${i.display_id}] ${i.project_name} | ${i.category} | ${i.telegram_post_date?.substring(0,10)}`));
}

check();
