# JobPilot — Phase 6

Personal, single-owner job-search workspace using React, TypeScript, Vite,
Supabase Auth/Postgres/private Storage, Vercel, and vite-plugin-pwa.
Phase 1 authentication remains in place. Phase 2 adds an administrator-appointed
owner, a persistent profile, private PDF resumes, and an installable app shell.
Phase 3 adds Gmail label-scoped and Greenhouse imports, manual jobs, explainable
matching, and saved/dismissed/review state. Phase 4 adds application drafts,
explicitly confirmed Gmail sending, delivery-unknown reconciliation, and manual
tracking for applications sent elsewhere. Phase 5 adds owner-controlled hourly
discovery through Supabase Cron, OFF by default, with Philippine-time status and
automatic dashboard refresh. AI, website submission, automatic sending, offline
background sync, and follow-ups remain unavailable.

**For an existing Phase 5 installation, follow [the Phase 6 rollout guide](PHASE6.md).**
It adds search profiles, conservative Gmail alert parsing, public Lever/Ashby boards,
optional Adzuna, cross-source provenance and deduplication, and source health through
the existing hourly scheduler. New sources start disabled. The guide includes
limitations, local verification, exact hosted rollout order, monitoring, and rollback.
No deployment, hosted change, Cron configuration, or live provider call was performed.

**For an existing Phase 4 installation, follow [the Phase 5 rollout guide](PHASE5.md).**
It covers the additive migration, dedicated scheduler secret, Vault, administrator-run
Cron creation, monitoring, pause, non-destructive rollback, and hosted acceptance.
No hosted rollout, Cron creation, or real email was performed during implementation.

**For an existing Phase 3 installation, follow [the Phase 4 rollout guide](PHASE4.md).**
It documents the data-preserving migration, Google Data Access change, both Edge
redeployments, fresh Gmail sending consent, local checks, and one controlled live
acceptance test to an address you own. No hosted rollout or live sending was done
during implementation.

**For an existing Phase 2 installation, use [the Phase 3 setup and deployment guide](PHASE3.md).**
It includes the exact Google callback URI, backend secrets, new migration and
Edge Function commands, API contract, parsing limits, and hosted/phone acceptance.
The original setup instructions below remain for first-time installation.

**Frontend deployment and database migrations are separate operations.** Deploying
to Vercel does not apply SQL or appoint an owner. This implementation run does not
apply hosted migrations, change hosted Auth settings, push source, or deploy.

## 1. Review the repository and public environment inputs

PowerShell (Node.js 24 LTS, Docker Desktop for local database tests):

```powershell
Set-Location 'C:\Users\revil\Projects\jobpilot'
npm.cmd ci
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
git status --short
git check-ignore .env.local
git ls-files .env .env.local 'supabase/.temp/*'
```

Edit `.env.local` yourself. Only these two public build-time variables are used:

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_WITH_YOUR_PUBLISHABLE_KEY
```

Never put a service-role/admin/secret key, database password, Gmail credential,
or refresh token into a VITE_ variable. All VITE_ values are shipped to browsers.
Legacy anon JWT keys are not accepted by this app's existing configuration validator.
Keep `.env.example` placeholder-only. Restart Vite or redeploy after changes.
Missing/malformed configuration produces setup guidance without echoing values.

Phase 1 already tracked files under `supabase/.temp/`. They are CLI-generated linked
project metadata, not reusable configuration. Before your first repository push,
review and untrack that directory (keeps the local files):

```powershell
git rm --cached -r -- supabase/.temp
```

The ignore rule now excludes new CLI metadata. An ignore rule alone does not
untrack files. This implementation does not alter your existing Git index.

## 2. Inspect the linked hosted project (read-only commands)

The Supabase CLI is already a project dev dependency. Use the installed version:

```powershell
npx.cmd --no-install supabase --version
npx.cmd --no-install supabase projects list
Get-Content .\supabase\.temp\project-ref
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --skip-vault --dry-run
```

If authentication is required, run `npx.cmd --no-install supabase login` yourself.
Check the printed project reference against the intended project in the dashboard.
Do not paste CLI tokens or database passwords into source or chat. If linking is
needed, explicitly select your project before proceeding:

```powershell
$ProjectRef = Read-Host 'Intended Supabase project reference'
npx.cmd --no-install supabase link --project-ref $ProjectRef
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --skip-vault --dry-run
```

Dry-run lists pending migrations; it does not prove SQL compatibility. In the SQL
Editor inspect existing `public.owner_profiles`, `public.resumes`,
`public.resume_defaults`, `jobpilot_private`, the `resumes` bucket, and Storage
policies before applying. These migrations deliberately fail on name collisions
rather than overwrite another application's data. Back up any existing database.
Do not use `db reset --linked`.

## 3. Apply the reviewed migrations, then bootstrap ownership

Versioned migrations, in order:

1. `20261011000100_owner_profile.sql`: private singleton owner registry; restricted
   owner-check function; validated profile schema; owner-only RLS and grants.
2. `20261011000200_private_resumes.sql`: private `resumes` bucket with PDF-only MIME
   and 10 MiB limit; pending/ready metadata; single-row default reference; Storage
   RLS; restricted completion/default-selection RPCs.
3. `20261011000300_storage_policy_guards.sql`: restrictive guards so pre-existing
   permissive Storage policies cannot bypass owner/folder checks, register-free
   uploads, or the no-overwrite rule. Other buckets are not restricted by these guards.

After you approve the dry-run and backups:

```powershell
npx.cmd --no-install supabase db push --linked --skip-vault --dry-run
npx.cmd --no-install supabase db push --linked --skip-vault
npx.cmd --no-install supabase migration list --linked
```

### Exact owner bootstrap procedure

1. In the **same Supabase project**, open Authentication → Users. Find your existing
   confirmed email/password user. Copy its **user UUID**, not its email, project ID,
   JWT, or key. This phase does not create/invite a hosted user or send email.
2. Display the reusable bootstrap script:

   ```powershell
   Get-Content .\supabase\bootstrap-owner.sql
   ```

3. Open Supabase **SQL Editor** as the database administrator (`postgres`). Paste
   that script into a new query. Replace only
   `'REPLACE_WITH_EXISTING_AUTH_USER_UUID'` with your copied UUID. Do not save your
   account-specific version into migrations, Git, or a VITE_ variable.
4. Run the whole query. It verifies the UUID exists in `auth.users`, serializes
   registration with a table lock, and registers exactly one owner. Repeating it
   with the same UUID is harmless. A different existing owner raises a clear
   exception and the transaction does not change ownership. A missing Auth user
   raises an exception. An unchanged placeholder fails UUID parsing.
5. Verify the returned UUID and timestamp. Sign in and open Profile. Until this
   bootstrap succeeds, private data access is denied even to authenticated users.

The registry is not exposed as an API table and has no client write grants/policies.
There is no browser owner-appointment API and no email allowlist security boundary.
The helper returns only whether the current JWT belongs to the registered owner.
Only authenticated callers can execute it; completion/default RPCs explicitly
recheck ownership and use a fixed empty search path. Administration can change
ownership via SQL, but the bootstrap intentionally does not support reassignment.

Disable public sign-ups in the hosted Supabase Auth settings; absence of a sign-up
screen does not disable its API. RLS still denies authenticated non-owners even if
another account exists. Keep anonymous sign-ins disabled. No Auth-account deletion
is required by Phase 2 or rollback.

## 4. Local checks

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run verify:pwa
npm.cmd run dev -- --host 127.0.0.1
```

In a second terminal, for the built site:

```powershell
npm.cmd run preview -- --host 127.0.0.1 --port 4173
```

PWA registration is enabled in production builds only. The development server does
not exercise the service worker. Localhost is a secure-context exception; actual
phone installation requires the deployed HTTPS site (or a trusted local HTTPS setup).

### Real local database/RLS checks

Docker Desktop must be running. These commands use the local Supabase project,
not the linked hosted database:

```powershell
npx.cmd --no-install supabase start
npx.cmd --no-install supabase migration up --local
npx.cmd --no-install supabase test db --local
```

The pgTAP suite creates synthetic Auth users inside a rolled-back transaction.
It checks fail-closed ownership, anonymous/owner/non-owner access, profile
constraints, metadata, Storage insertion/visibility, helper permissions, and
consistent default selection/deletion. Use a fresh, unbootstrapped local database;
it deliberately refuses an already configured owner. Do not point fixture tests
at production. Storage's API enforces MIME/size limits; SQL tests inspect bucket
settings and exercise RLS, not file-byte validation or malware scanning.
Modern Storage blocks direct SQL object deletion; do not disable that protection.
Use the separate local API checks for real profile persistence, file deletion,
MIME/size rejection, and concurrent default selection:

```powershell
npm.cmd run test:storage:local
```

This script refuses a configured owner or a non-default local API URL. It creates
synthetic local Auth rows without sending emails, uses local test JWTs, exercises
PostgREST and Storage over HTTP, then deletes only its own generated fixtures.
It does not test password sign-in. Do not interrupt it during fixture cleanup; if
it fails, inspect the local instance before rerunning. No hosted credentials are used.

For actual Edge rendering with **mocked** Supabase responses, leave Vite preview
running on port 4173 and use another PowerShell terminal:

```powershell
npm.cmd run test:browser
```

The browser script uses installed Microsoft Edge, blocks external requests with
mock responses, checks responsive layouts and cache contents, and writes synthetic
screenshots to ignored `artifacts/`. Its isolated browser profiles are under ignored
`.browser-check/`; it never opens your personal browser profile. Port 9222 must be
available. `JOBPILOT_BROWSER` can override the executable path. This is not a live
hosted authentication or real-phone test.

`npm test` uses mocked Supabase responses and inert data with external network
requests forbidden. It is not proof of live authentication, database policies,
Storage service behavior, or device installation. It retains the original 38
Phase 1 checks and adds profile and resume failure-path coverage.

### Implementation-run results

- `npm run lint`: passed with no lint findings.
- `npm test`: 57 passed, including all original 38 Phase 1 checks. Supabase is mocked.
- `npm run build`: passed; Vite reports a non-blocking 521 kB main-chunk warning
  (about 151 kB gzip). Dependencies and the lockfile are unchanged.
- `npm run verify:pwa`: passed. The generated worker has 9 unique public precache
  assets, navigation-only fallback, no runtime API caching, and explicit activation.
- `supabase start` and `supabase migration up --local`: all three migrations applied
  to a real local Docker instance, not the linked hosted project.
- `supabase test db --local`: 49 pgTAP database/RLS checks passed.
- `npm run test:storage:local`: passed real local PostgREST profile persistence,
  Storage authorization/size/MIME/delete checks, bootstrap error cases, and concurrent
  default selection. Synthetic fixture cleanup completed.
- `npm run test:browser`: passed in real headless Edge using mocked Supabase HTTP
  responses: profile save/reload, offline controls/draft retention, keyboard field
  order, responsive layouts, reduced-motion emulation, and cache inspection.
  Screenshots were reviewed at 390 and 1440px; phone/tablet layouts were also checked
  at 360, 375, 768, 1024 and 932×360 landscape.
- `git diff --check`: passed (Git reports existing LF-to-CRLF normalization notices).
- Design detector: advisory documentation gaps for existing secondary/error/border
  colors. No independent subagent review was performed; review was in-thread.

Unverified: real Android/iPhone installation, Safari, screen readers, hosted login
and token lifecycle, hosted Storage, Vercel deep links, and an actual two-version
PWA update/reload cycle. Prompt and activation behavior were inspected in source
and the generated worker; do not treat that as a deployed-update test. Rollback was
reviewed but not executed. No hosted migration, deployment, Git push, or email occurred.

## 5. Push to your private GitHub repository (owner-run only)

Install/authenticate GitHub CLI and Git first. Review the entire staged diff for
personal data, local credentials, and generated metadata. Do not push `.env.local`.

```powershell
gh auth status
git status --short
git diff --check
git add src tests scripts public supabase/migrations supabase/tests supabase/bootstrap-owner.sql supabase/rollback-phase2.sql package.json vite.config.ts index.html vercel.json .gitignore README.md PRODUCT.md DESIGN.md AGENTS.md
git diff --cached --stat
git diff --cached
git commit -m 'Add owner-only profile, private resumes, and installable access'
$Repository = Read-Host 'Private GitHub repository name (for example jobpilot)'
gh repo create $Repository --private --source . --remote origin
git push -u origin HEAD
gh repo view --json visibility
```

If `origin` already exists, inspect `git remote -v`, confirm the repository is yours
and private, skip `gh repo create`, and push only after review. Do not force-push.
If needed, authenticate with `gh auth login` yourself. Creating/pushing the repo
is separate from both Supabase migrations and Vercel deployment.

## 6. Deploy the frontend to Vercel

Recommended: Vercel dashboard → Add New Project → import your private GitHub repo.
Grant only the required repository access. Choose **Vite**, root directory `.`,
build command `npm run build`, output directory `dist`, Node.js 24.x. Add both
public Supabase variables above to **Production** (and Preview only if you intend
those deployments to access that backend). Do not give untrusted previews access
to production sessions. Rebuild after variable changes.

For an already installed Vercel CLI, exact interactive PowerShell commands are:

```powershell
vercel --version
vercel login
vercel link
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_PUBLISHABLE_KEY production
vercel deploy
vercel deploy --prod
```

The `env add` commands prompt for your public values. Review the preview before the
production command. Do not use an unreviewed floating CLI install during deployment.
The Git integration can deploy without installing a Vercel CLI locally.

`vercel.json` retains SPA rewrites. Static service-worker/manifest assets must be
served as files, not HTML. Service-worker and HTML responses are revalidated so
updates can be discovered. Verify `/profile`, `/resumes`, `/jobs`, and `/settings`
by direct navigation and reload on the hosted site; Vite preview is not a test of
Vercel's routing configuration.

### Supabase Auth URLs

In Authentication → URL Configuration:

- Set **Site URL** to your exact Vercel production HTTPS origin (no guessed hostname).
- Add the exact production `/login` URL and any explicitly trusted preview `/login`
  URL to **Redirect URLs**, not a broad wildcard for arbitrary deployments.
- For intentional local development, add `http://localhost:5173/login` and/or
  `http://127.0.0.1:5173/login`. Add port 4173 only when testing the production preview.

Current password sign-in does not use OAuth/email redirect callbacks, but these
values must be correct for Supabase-generated account flows. Phase 3 Gmail OAuth
uses the separate Edge callback documented in PHASE3.md. Password reset remains
unimplemented. Do not send test application emails.

## Data, failure handling, and PWA privacy

- Only name and contact email are required for a saved profile. Optional values are
  SQL NULL when unset, including preference lists. Experience/projects are bounded
  free-form text, not inferred structured employment records. Salary uses bounded
  decimal columns and explicit currency/pay period. No resume content is parsed.
- Drafts and loaded data live in React memory only. They survive in-app navigation
  but not closing/reloading/signing out. Before-unload warns for dirty profiles;
  explicit reload/sign-out asks before discarding. Session expiry still hides
  private UI and clears state, prioritizing session security over draft recovery.
- Existing Supabase session persistence/refresh remains enabled. Only the session
  is stored by the SDK; profile/resume data is not put into localStorage, IndexedDB,
  or the service-worker cache. Shared devices must sign out.
- Upload creates pending metadata first, writes to `owner-uuid/random-uuid.pdf`
  without overwrite, then calls a server check before marking ready. Incomplete
  rows remain visible after errors. “Finish upload” retries completion when the
  object exists; otherwise delete the incomplete row/file and upload again. This
  avoids deleting possibly committed data after an ambiguous timeout. A crashed
  browser does not erase the recovery record.
- Deletion removes Storage first, then metadata. Partial deletion is reported;
  retry is safe when the file is already absent. If metadata deletion is uncertain,
  refresh first. Deleting the selected resume clears its default reference. No
  resume is automatically selected as default. Concurrent default changes are
  serialized by the database's one-row-per-owner constraint/upsert; last successful
  selection wins. Lists in other tabs require refresh.
- Downloads use authenticated Storage requests and temporary Blob URLs, revoked
  after handoff/unmount. There are no permanent public links or signed-link cache.
  A user-requested downloaded file is intentionally saved outside the app by the
  browser; protect/delete that local copy yourself. The app cannot revoke it.
- The service worker precaches only build-time public shell assets, with no runtime
  API caching, background sync, or mutation queue. Supabase fetches use `no-store`.
  Offline detection disables mutations/downloads; request errors are still handled
  when `navigator.onLine` is wrong. Previously loaded data may remain in memory while
  the tab is offline, but a cold offline launch cannot retrieve private data.
- App updates show a prompt and require confirmation before activation/reload.
  Save work and finish uploads in **all open tabs** first. An initial installation
  needs no reload; an existing waiting update never auto-applies during editing.

### Phone installation and manual acceptance

Android: open the deployed HTTPS site in Chrome → menu → Install app / Add to Home
screen. iPhone: Safari → Share → Add to Home Screen → Add (enable Open as Web App
when offered). Installation labels vary by OS/browser. Each device signs in
independently. A standalone icon does not enable scheduled job automation.

Check owner login/session refresh/sign-out, saved profile after reload, every resume
operation, retry after interrupted upload/deletion, default switching in two tabs,
non-owner denial, offline controls, and update postponement with a dirty form.
Check phone widths 360/375/390, tablet 768/1024, desktop 1440, landscape, 200% zoom,
keyboard focus, touch targets, safe areas, and screen-reader announcements. Verify
Gmail reflects its saved status and automation remains Not implemented. Confirm cache contents
in DevTools → Application → Cache Storage contain no API URLs/private data.
Phone installation, iOS behavior, screen readers, and hosted Auth/Storage/Vercel
behavior require actual device/hosted checks; browser emulation is not a substitute.

## Undo Phase 2 only (destructive; review and back up first)

Do not run rollback as part of ordinary deployment. Roll back the frontend to the
known Phase 1 release first; installed clients may need the update applied and
old service workers unregistered. Export/back up your profile and resume metadata,
and download private files you wish to keep. These instructions deliberately
remove Phase 2 data but never delete your Supabase Auth user or unrelated tables.

1. Delete Phase 2 resumes using JobPilot or the Storage dashboard/API; resolve any
   partial failures. Delete the **empty `resumes` bucket** in the Storage dashboard.
   Never directly DELETE rows from `storage.objects`/`storage.buckets` using SQL.
2. Read `supabase/rollback-phase2.sql`. It drops only the named JobPilot policies,
   RPCs, three public tables, and private registry/schema, without `CASCADE`.
   It refuses to run if the bucket remains or explicit confirmation is absent.
3. In the SQL Editor as administrator, after accepting the data loss, run
   `SET jobpilot.confirm_phase2_rollback = 'yes';` followed by the entire rollback
   script in the same session/query. The transaction leaves Auth and other buckets
   and policies untouched. Any unexpected dependency causes rollback, not cascading
   deletion of unrelated objects.
4. Keep migration history aligned with your rollback strategy: preferably record
   the reviewed rollback as a **new versioned migration** on a rollback branch. If
   you instead manually undo and want to mark the three original migrations as
   reverted, first remove/archive those migrations on that branch so a future push
   does not immediately reapply them, then run only after reviewing the target:

   ```powershell
   npx.cmd --no-install supabase migration repair 20261011000100 20261011000200 20261011000300 --status reverted --linked
   npx.cmd --no-install supabase migration list --linked
   npx.cmd --no-install supabase db push --linked --skip-vault --dry-run
   ```

No rollback command is executed during implementation. A future reintroduction
requires explicit migration/owner-bootstrap review, not automatic owner reassignment.
