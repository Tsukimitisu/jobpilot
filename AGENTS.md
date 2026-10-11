# JobPilot development instructions

Before implementation, inspect the available skills under
.agents/skills and read the SKILL.md files relevant to the task.

Use relevant skills for:
- React components and mobile layouts
- Accessibility and interface design
- Backend architecture and database changes
- OAuth, Gmail credentials, RLS, and private resume storage
- Debugging and code review

State which skills you selected and why.
If a requested skill is missing or incompatible, report it.
Do not claim a skill was used without reading its instructions.

Project constraints:
- Personal-use application for one owner.
- React + TypeScript + Vite frontend.
- Supabase Auth, Postgres, Storage, Edge Functions, and Cron.
- Vercel frontend hosting.
- Mobile-friendly installable web app.
- Scheduled work must run with the laptop off.
- Gmail secrets and refresh tokens stay on the backend.
- No real application emails during development or tests.
- Preserve this stack unless a change is explicitly agreed.

Verification:
- `npm run lint`, `npm test`, `npm run build`, then `npm run verify:pwa`.
- Frontend tests mock Supabase and prohibit network requests; do not call them live checks.
- Local RLS checks: `npx --no-install supabase start`, `npx --no-install supabase migration up --local`, then `npx --no-install supabase test db --local`.
- Never use linked/hosted migration or deployment commands during implementation without explicit approval.
- Modern Supabase Storage blocks SQL object deletion. Use the Storage API; do not disable its protective trigger.
- PWA caching must remain public-shell-only; preserve prompt-based updates and in-memory-only private drafts.
- Owner bootstrap and rollback are administrator-run scripts separate from reusable migrations. See README.md.