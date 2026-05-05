const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const getVal = (key) => envFile.match(new RegExp(`${key}=(.+)`))[1].trim();

const supabase = createClient(getVal('SUPABASE_URL'), getVal('SUPABASE_SERVICE_ROLE_KEY'));

async function check() {
  const { data, error } = await supabase.from('parsed_items').select('source_channel, message_id, project_name').limit(10);
  if (error) console.error(error);
  else console.log(data);
}

check();
