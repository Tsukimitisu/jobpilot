import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
await mkdir('supabase/functions/phase4-fixture',{recursive:true})
await writeFile('supabase/functions/phase4-fixture/index.ts',await readFile('scripts/fixtures/application-edge.ts'))
await writeFile('supabase/functions/phase4-fixture/deno.json',await readFile('supabase/functions/jobpilot-api/deno.json'))
await writeFile('.env.phase4-test.local',`JOBPILOT_APP_ORIGIN=http://127.0.0.1:4173\nGOOGLE_CLIENT_ID=phase4-fixture-client\nGOOGLE_CLIENT_SECRET=inert-fixture-secret\nGMAIL_TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64url')}\n`)
console.log('Prepared ignored local-only Edge fixture and inert Google configuration. No production entrypoint was changed. Never deploy phase4-fixture.')
