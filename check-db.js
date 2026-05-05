const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const getVal = (key) => envFile.match(new RegExp(`${key}=(.+)`))[1].trim();

const supabase = createClient(getVal('SUPABASE_URL'), getVal('SUPABASE_SERVICE_ROLE_KEY'));

async function check() {
  const { data, error } = await supabase
    .from('parsed_items')
    .select('project_name, category, status, telegram_post_date, date_found, created_at')
    .eq('status', 'approved');
  if (error) console.error(error);
  else data.forEach(i => console.log(`${i.project_name} | status=${i.status} | telegram_post_date=${i.telegram_post_date} | date_found=${i.date_found} | created_at=${i.created_at}`));
}

check();
