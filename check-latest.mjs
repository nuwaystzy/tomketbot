import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(k+'=(.+?)(?=\\n|$)'))[1].trim();
const s = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

async function run() {
  const { data } = await s.from('parsed_items').select('id, project_name, status, telegram_post_date, created_at').order('id', { ascending: false }).limit(10);
  console.log(JSON.stringify(data, null, 2));
}
run();
