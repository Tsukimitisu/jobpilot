import { schedulerHandler } from '../_shared/scheduler.ts'
import { runtime } from '../_shared/runtime.ts'
const { db, config } = runtime()
Deno.serve(schedulerHandler(db, config, Deno.env.get('JOBPILOT_SCHEDULER_SECRET') ?? ''))
