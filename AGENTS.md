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