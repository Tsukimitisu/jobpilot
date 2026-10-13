import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHmac, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const config = JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
assert.equal(config.API_URL,'http://127.0.0.1:54321','local Supabase only')
// Roll back everything, including the Cron row: no tick or HTTP request can run.
const script = readFileSync('supabase/phase5-cron.sql','utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')
const secret = randomBytes(32).toString('base64url')
const setup = `do $$ begin
  perform vault.create_secret('${secret}','jobpilot_scheduler_secret');
  perform vault.create_secret('https://fixture.supabase.co','jobpilot_project_url');
end $$;`
const assertions = `do $$ begin
  if (select count(*) from cron.job where jobname='jobpilot-discovery-hourly' and schedule='0 * * * *') <> 1 then raise exception 'Cron schedule mismatch'; end if;
  if has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') or has_table_privilege('anon','vault.decrypted_secrets','SELECT') then raise exception 'Vault credential exposed'; end if;
  if has_function_privilege('authenticated','jobpilot_private.dispatch_discovery()','EXECUTE') then raise exception 'Browser dispatch privilege'; end if;
  if exists(select 1 from net.http_request_queue q, vault.decrypted_secrets s where s.name='jobpilot_scheduler_secret' and position(s.decrypted_secret in q.headers::text)>0) then raise exception 'Long-lived credential exposed'; end if;
end $$;`
const output = execFileSync('docker',['exec','-i','supabase_db_jobpilot','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input:`begin;\n${setup}\n${script}\nselect jobpilot_private.dispatch_discovery();\n${assertions}\nselect headers->>'Authorization' from net.http_request_queue;\nrollback;`,encoding:'utf8',stdio:['pipe','pipe','pipe']})
const [,time,signature] = output.match(/^Bearer (\d{10})\.([a-f0-9]{64})$/m) ?? []
assert.ok(time && signature)
assert.equal(signature,createHmac('sha256',secret).update(`jobpilot-discovery-v1:${time}`).digest('hex'),'Postgres HMAC agrees with scheduler protocol')
console.log('Local Cron/Vault setup SQL PASS, fully rolled back: hourly job, purpose-bound HMAC compatible with scheduler, secret absent from queue, Vault/dispatch private. No HTTP request executed.')
