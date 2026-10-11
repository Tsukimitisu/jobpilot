import { apiHandler } from '../_shared/service.ts'
import { runtime } from '../_shared/runtime.ts'
const { db, config } = runtime()
Deno.serve(apiHandler(db, config))
