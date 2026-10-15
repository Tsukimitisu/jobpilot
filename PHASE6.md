# Phase 6: broad job discovery

Implementation and verification are local only. No hosted database was changed,
no function or frontend was deployed, no Git changes were pushed, no Cron was
configured, and no live provider API or email send was used. Phase 4 review,
fresh sending consent, final confirmation, and delivery reconciliation remain
unchanged. Discovery creates jobs and provenance, never applications or emails.

## Architecture and authorization

The existing `jobpilot-api`, importer, and `discovery-scheduler` are extended.
There is no second scheduler. The existing Phase 5 hourly Supabase Cron invokes
the same HMAC-authenticated scheduler while the laptop is off. Its dedicated
signing secret and administrator-owned Vault configuration are unchanged.
The frontend polls private data while visible/online, including dashboard results.

Owner actions verify the Auth user and registered owner on the server. Search
profiles have owner-only SELECT RLS; all mutations go through the authorized Edge
API. Browser roles cannot call worker RPCs. Helper functions and cooldown/lease
tables live in `jobpilot_private`, outside exposed API schemas. Security-definer
functions use an empty search path and explicit grants. Source and owner locks,
lease fencing, and per-candidate checkpoints protect overlapping workers.

New tables/fields are additive. Existing Gmail and Greenhouse configuration,
jobs, application records, private resumes, and sending workflow are preserved.
New profiles and newly added public sources start disabled. Removing a source
disables and hides it; historical jobs and source attribution remain. Re-adding
that identifier restores it disabled with a fresh cursor. Existing enabled
sources are not silently disabled by migration.

The owner API adds `save_search_profile`, `delete_search_profile`, `add_source`,
`remove_source`, `test_source`, `run_discovery`, and `discovery_configuration`.
Configuration returns only Adzuna's configured state, never credentials.
The existing toggle/import and automation actions remain available.

## Profiles and matching

Settings supports up to 20 persistent profiles. Each has a unique owner/name,
one or more desired titles, alternative titles, required/excluded keywords,
preferred Philippine locations, work modes, employment types, maximum experience,
optional minimum salary, per-source result limit, and enabled state. Lists allow
up to 20 entries of 100 characters, names 100 characters, experience 0–50 years,
salary PHP 0–10,000,000 per month, and result limits 1–50. Zero years means
entry-level; blank experience or salary means no preference. Database constraints
and server validation enforce the inputs independently of the form.

All enabled profiles apply to every discovered job. The importer stores an
explanation snapshot; Jobs recalculates against current enabled profiles so edits
take effect without reimporting. The best profile score determines ranking.
With no enabled profiles, existing profile matching remains available, public
ATS/Gmail imports have a limit of 50, and Adzuna reports no enabled search profiles.
When several profiles are enabled, the smallest result limit bounds each source
attempt; duplicate candidates also consume that limit.

Scores are deterministic, clamped to 0–100: title 35, matched required keywords
up to 25, preferred location 15, work mode 15, employment type 10; each excluded
keyword subtracts 40 and excessive explicitly stated experience subtracts 30.
Salary comparison is explanatory only and requires explicit PHP/month data.
Unknown salary, location, work mode, employment type, or experience stays unknown.
These are ranking signals, not eligibility guarantees or hard exclusion filters.
Missing criteria do not receive bonus points. Salary is never currency-converted
or inferred from an estimated annual foreign salary.

## Sources and limitations

### Gmail alerts

The existing confirmed Gmail label and mailbox-generation checks remain enforced.
Every fetched message is checked for current label membership. The parser
recognizes direct job links from LinkedIn, Indeed, JobStreet, Glassdoor, Kalibrr,
and Bossjob, plus explicit structured job fields in other alert emails. It stores
the alert message identifier, original provider, external job identity when
available, direct URL, and high/medium/low parsing confidence on provenance.

Explicit title/company/job-URL fields are high confidence. Recognized linked
titles are medium confidence; plain URLs or ambiguous alerts are low confidence
and visibly require review. Confidence describes extraction, not sender
authenticity. Unsupported regional domains, tracking wrappers, templates without
direct links, and ambiguous multi-job text may remain low confidence. The parser
does not follow tracking redirects, scrape sites, or invent missing fields.
It caps candidates at 50/message, inspects at most 500 links, and bounds text.
Synthetic email fixtures contain no private mailbox content.

Owner setup after rollout:

1. Create job alerts on the services you already use, using their normal UI.
2. In Gmail, create a custom label such as `JobPilot/Alerts`. Create filters using
   the actual sender/subject of received alerts; preview the search before applying
   the label. Include existing matching conversations if desired. Keep unrelated
   personal email out of this label.
3. In JobPilot, connect the intended Gmail account, load labels, and explicitly
   confirm that label. Sending consent is not needed for discovery.
4. Test the source and inspect a small import. Keep low-confidence jobs under
   review. Adjust the Gmail filter if unrelated messages are included.

Only email already in the selected label is read. No website login automation,
CAPTCHA bypass, LinkedIn scraping, form submission, or automatic sending occurs.

### Public ATS boards

In Settings, select the provider and enter only the company board identifier
(letters, numbers, underscore, hyphen; up to 100 characters), then Add disabled
source, Test source, review the preview, and explicitly Enable it.

| Provider | Identifier from a public board URL | Endpoint used |
| --- | --- | --- |
| Greenhouse | `boards.greenhouse.io/<identifier>` or `job-boards.greenhouse.io/<identifier>` | `https://boards-api.greenhouse.io/v1/boards/<identifier>` and `/jobs?content=true` |
| Lever | `jobs.lever.co/<identifier>` | `https://api.lever.co/v0/postings/<identifier>?mode=json&skip=…&limit=…` |
| Ashby | `jobs.ashbyhq.com/<identifier>` | `https://api.ashbyhq.com/posting-api/job-board/<identifier>` |

Test previews up to three available titles without importing. Greenhouse supplies
a company name. Lever/Ashby public responses used here do not supply a verified
company name, so preview shows the configured board and explicitly unknown
company rather than converting a slug into a guessed employer. Lever uses the
global endpoint; EU-hosted Lever boards are not supported in this phase.
Ashby imports only explicitly listed jobs. Descriptions are converted to text,
not rendered as provider HTML. Public redirects are rejected.

See the official [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html),
[Lever Postings API](https://github.com/lever/postings-api), and
[Ashby public posting API](https://developers.ashbyhq.com/docs/public-job-posting-api).

### Optional Adzuna

Create a developer account and application through the official
[Adzuna API overview](https://developer.adzuna.com/overview), obtain its application
ID and key, and review your account's access/quota and the
[job search API documentation](https://developer.adzuna.com/docs/search).
Do not paste credentials into JobPilot Settings, SQL, source control, browser
variables, screenshots, or command-line arguments.

Set **ADZUNA_APP_ID** and **ADZUNA_APP_KEY** only in Supabase Dashboard → Edge
Functions → Secrets for the intended project. The runtime reads them from
`Deno.env`; they are never stored in JobPilot tables, returned by the API, or
included in frontend bundles. The provider requires them in the server-to-provider
request; request URLs, raw provider errors, headers, and payloads are not logged
by this implementation. Do not enable URL/body tracing for these requests.
If either secret is absent, Settings shows **Not configured**, the Adzuna attempt
ends safely, and other sources continue. No Adzuna secret is required for ATS/Gmail.

Add a disabled Adzuna source by explicitly selecting a supported country market,
enable at least one search profile, test, then enable the source. The current
supported market list is GB, US, AU, AT, BR, CA, DE, FR, IN, IT, NL, NZ, PL, SG, ZA.
**There is no Philippine Adzuna market.** Philippine locations and PHP/month salary
preferences are not sent as foreign-market API filters. Results are assessed
locally, and the owner must verify remote and Philippine applicant eligibility.

Queries use enabled profiles' desired/alternative titles and required/excluded
keywords. One page is fetched per source turn, at most three pages per title,
with at most the profile/source limit per page. Profile/title/page/row offset and
a hash of enabled profile configuration are persisted. Changing profiles resets
an obsolete cursor. Results beyond three pages/title are outside the bounded
search; refine titles to narrow the search. Adzuna descriptions are snippets and
salary estimates are deliberately not imported.

## Deduplication and resumption

Discovery checks source/external identity, then shared provider/external job
identity, canonical application URL (including previously recorded origin URLs),
then a SHA-256 fingerprint of normalized company/title/location/description.
Fingerprinting requires nonempty company/title/location and at least 40 characters
of description. Missing information never becomes a confident fingerprint match.
Different explicit job IDs from the same provider do not collapse solely because
their text is identical. URL canonicalization removes known tracking parameters
while preserving job identity parameters. Each source origin remains attached to
the existing job when a duplicate is found. Existing jobs are not retroactively
merged, and sparse/email-only records can remain separate until a strong identity
is available. There is no fuzzy employer/title-only collapse.

Candidate writes/counts and subsequent checkpoints are individually fenced.
A crash between storing a candidate and checkpointing can replay it safely as a
duplicate. Failure preserves the last committed checkpoint. Gmail checkpoints
contain page/message/job offsets; Greenhouse uses job ID, Ashby job URL, Lever an
offset, Adzuna profile/title/page/row offset. Completing a pass clears its cursor so
a later turn checks fresh listings. Provider pages are mutable snapshots: changes
between turns can replay or defer a listing until the next complete pass. There
is no completeness guarantee for listings removed before a later check. Existing
jobs are retained; this phase does not refresh/expire every historical listing.

## Scheduler and health

Each existing hourly tick selects at most three eligible sources, oldest attempt
first, with a 100-second work deadline and 40-provider-request ceiling. Each source
has a 90-second cap within that overall deadline; each HTTP request has a ten-second
timeout and eight-MB response cap. Gmail examines at most ten messages per turn.
Greenhouse/Ashby download their bounded-size public board response but commit only
the candidate limit. No unbounded pagination loop runs in a worker.

One source failure produces a partial run and does not stop other eligible sources.
Retries happen on later turns, with persisted exponential backoff starting at one
minute, capped at one day. Provider `Retry-After` seconds or HTTP dates take
precedence when later. HTTP 429 and explicit retry hints also impose a shared
owner/provider cooldown, checked before subsequent requests and new attempts,
including other Adzuna country sources. No immediate retry storm or worker sleep
is used. A successful attempt has at least a one-minute cooldown and cannot
shorten a longer already-recorded cooldown.

Phase 5's owner/run lease and source unique-running lock remain authoritative.
Pausing/removing a source cancels its active import and invalidates later writes;
quickly re-enabling cannot revive that worker. A source test shares the source
lock and cooldown, has a 40-second deadline, and writes no jobs. Run discovery now
uses the same bounded importer, with an owner lease of three minutes and a
one-minute repeat-click cooldown. It is an explicit manual action even when hourly
automation is paused. Manual and scheduled runs can work on different sources;
they cannot concurrently process the same source. UI busy state is backed by
database protection, including across tabs.

Source health includes a separate provider retry timestamp, propagated to sibling
sources and inherited by newly added sources. Shared rate limits/retry delays are
visible without inventing a failed attempt or replacing a previous attempt error.
Source health shows enabled state, last attempted, last successful **import**,
last attempt added/duplicate counts, friendly progress, rate-limit/cooldown state,
safe error, and next eligible time. Test attempts appear in history with zero
import counts and do not imply a successful import. Next eligible means the
earliest allowed check, not a guaranteed appointment; round-robin scheduling may
check it later. Provider details are mapped to safe codes, never displayed raw.

## Exact local verification commands

These commands target only the disposable local Supabase project. Docker must be
running. Never use a production owner or credentials for fixtures. The scripts
create synthetic local Auth users and remove their records in cleanup.

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run verify:pwa
npm.cmd run check:edge
npx.cmd --no-install supabase start
npx.cmd --no-install supabase migration up --local
npx.cmd --no-install supabase test db --local
npm.cmd run prepare:edge:local
# Separate terminal, local fixture functions only; keep running for integrations:
npx.cmd --no-install supabase functions serve --env-file .env.phase4-test.local --no-verify-jwt
# Original terminal, sequentially (they share the disposable local owner):
npm.cmd run test:discovery:local
npm.cmd run test:applications:local
npm.cmd run test:scheduler:local
# Separate terminal:
npm.cmd run preview -- --host 127.0.0.1
# Original terminal (headless Edge installed on Windows):
npm.cmd run test:browser
```

Do not deploy `phase4-fixture` or `phase5-fixture`. Their generated directories and
the inert `.env.phase4-test.local` are ignored and can be removed after stopping
the local function server. Do not run `test:cron:local` for this task: it configures
a temporary Cron job, which was outside the authorized verification scope.

## Hosted rollout order — administrator instructions, NOT executed

Prerequisite: an operational Phase 5 installation with the registered owner,
existing hourly Cron, Vault HMAC signing secret, Gmail callback, and Phase 4
workflow. First-time installations must follow the earlier phase guides in order.
No new Cron schedule is required or supplied by Phase 6.

1. Back up the hosted database using the project's approved backup process.
   Record current versions/configuration. Pause Automation in Settings and let any
   active run finish/expire. Confirm the project reference before any CLI command.
2. Apply migrations **20261014000700_broad_discovery.sql**, then
   **20261014000800_discovery_checkpoints.sql**. On the already linked Phase 5
   project, run the following. Stop if the dry run lists unexpected migrations;
   these commands are documentation only and were not executed against hosting.

   ```powershell
   $phase6ProjectRef = Read-Host 'Confirmed Supabase project reference'
   npx.cmd --no-install supabase migration list --linked
   npx.cmd --no-install supabase db push --linked --skip-vault --dry-run
   npx.cmd --no-install supabase db push --linked --skip-vault
   ```

   Owner bootstrap remains a separate administrator script; never put it in these
   reusable migrations. Both migrations must be present before deploying workers.
3. Optionally set the two Adzuna secrets through Edge Function Secrets as described
   above. Preserve existing `JOBPILOT_APP_ORIGIN`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`, and
   `JOBPILOT_SCHEDULER_SECRET`, plus Supabase-managed runtime secrets. Do not rotate
   the scheduler key or encryption key as part of this rollout. No new OAuth scope
   or Gmail sending consent is needed.
4. Deploy only these production functions, after checking the selected project:

   ```powershell
   npx.cmd --no-install supabase functions deploy jobpilot-api --project-ref $phase6ProjectRef
   npx.cmd --no-install supabase functions deploy discovery-scheduler --project-ref $phase6ProjectRef
   ```

   Keep `gmail-callback` deployed unchanged. Retain scheduler `verify_jwt=false`
   and its existing internal HMAC authentication. Never deploy all fixture folders.
5. Build/verify and deploy the frontend to the existing linked Vercel project:

   ```powershell
   npm.cmd run build
   npm.cmd run verify:pwa
   vercel deploy --prod
   ```

   Use only the existing public `VITE_SUPABASE_URL` and publishable-key variables.
   Existing installed PWAs must accept the normal update prompt; private drafts
   remain memory-only, so save/discard them before accepting an update.
6. With automation still paused, perform the hosted checklist below. Add profiles
   and sources disabled, test each source, then explicitly enable selected profiles
   and sources. Run discovery now for a small batch. Finally re-enable the existing
   hourly automation and verify a later scheduled run with the laptop off.

## Hosted acceptance checklist — pending

- [ ] Owner can create/edit/disable/delete profiles; anonymous and non-owner users
      cannot read private rows or execute mutations/worker helpers.
- [ ] All newly added sources/profiles start disabled. Existing jobs, sources,
      resumes, application drafts, and history remain intact.
- [ ] Missing Adzuna credentials show Not configured; configured state exposes no
      values in browser requests/responses, bundles, errors, or logs.
- [ ] Preview one chosen public board per provider without importing; confirm
      unknown company where the provider omits it. Remove/re-add retains history.
- [ ] Confirm Gmail label/account, import selected alerts, verify provider/message
      attribution, direct links, confidence warnings, and label-only scope.
- [ ] Import bounded batches, see per-profile reasons/unknown fields, repeat an
      import and verify duplicate counts and provenance without lost positions.
- [ ] Two tabs/repeated clicks cannot overlap the same source. Pause prevents new
      writes; source failures do not block other providers. Do not deliberately
      exhaust live API quotas to test rate limiting; use local fixtures for that.
- [ ] Enable existing automation, close the laptop, and verify an hourly run in
      Supabase history and new results on a phone dashboard without redeploying.
- [ ] Verify source health/progress, later continuation, and safe errors. Check
      platform execution limits and Adzuna account quota against source volume.
- [ ] On a real phone/Safari and with a screen reader, inspect form labels, focus,
      navigation, touch targets, install/update prompting, and online-only private
      data. No private API response enters Cache Storage or offline HTML fallback.
- [ ] Phase 4 draft/review remains explicit and no application was auto-created.
      Any actual send acceptance requires separate explicit authorization; it is
      not part of Phase 6 verification.

## Monitoring and rollback

Monitor Settings → Automation, source health, `automation_runs`, and `import_runs`.
Use safe error codes/status/counts and timestamps; never log credentials, provider
URLs containing credentials, raw email bodies, or raw provider responses. Check
the existing Cron execution history if expected runs become overdue. A successful
HTTP scheduler invocation can still contain a partial/failed source result.

To stop automation, Pause in Settings. Disable a failing source independently,
or remove it while retaining provenance. Honor the displayed next eligible time;
repeated manual clicks do not bypass provider cooldowns. Reconnect Gmail only for
actual reconnect/consent errors. Correct a board identifier by removing/re-adding;
editing enabled Adzuna profiles resets obsolete search cursors automatically.

For a Phase 6 regression, pause automation and disable Lever/Ashby/Adzuna sources.
Wait for active manual/test/scheduled workers to finish or expire before changing
checkpoints. Phase 5 Gmail workers expect a plain Gmail page token and cannot read
Phase 6 JSON message/job checkpoints. An administrator must reset those Gmail
checkpoints before restoring older workers (safe deduplication replays the label):

```sql
begin;
update public.job_sources set cursor=null
where kind='gmail' and left(cursor,1)='{';
commit;
```

Then restore the previous frontend and production function artifacts together.
Retain the additive database schema and imported jobs. Keep new source kinds
disabled while older workers are deployed; do not delete discovery/application tables, undo
owner registration, disable Storage protections, or rotate unrelated keys.
Leave the existing Cron configuration intact while automation is paused. Resume
only after validating the restored combination. Destructive schema rollback would
require a separate reviewed migration and backup restoration plan.

## Verification record and changed files

Verification completed on the local workspace:

| Check | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm test` | PASS: 175 tests, 13 files; frontend/provider network mocked |
| `npm run build` | PASS; 587.88 kB main JS, 168.28 kB gzip; existing >500 kB warning |
| `npm run verify:pwa` | PASS: nine unique public cache assets, prompt-only activation, private-route exclusion, backend-secret-name bundle scan |
| `npm run check:edge` | PASS |
| Local Supabase start and migration application | PASS: migrations 007 and 008 applied locally |
| `supabase test db --local` | PASS: 254 assertions, five files |
| `test:discovery:local` | PASS: local Auth/Edge/PostgREST, mocked providers |
| `test:applications:local` | PASS: local Auth/Edge/PostgREST/Storage and mocked Gmail; no real sends |
| `test:scheduler:local` | PASS: Phase 5 regressions plus public connectors, source failure isolation, overlap, continuation, shared Retry-After |
| `test:browser` | PASS: headless Edge, mocked Supabase, seven viewport sizes |
| Independent final review | No remaining blockers; reviewer independently reran 46 targeted tests successfully |
| Hosted/Cron/live-provider/real-device acceptance | NOT RUN; checklist above remains pending |

Local coverage includes frontend network-prohibited mocks, parser/dedup fixtures,
pagination/profile changes, abort timeouts, retry headers, HTML rate-limit errors,
owner RLS/private grants, checkpoint failures, stale workers, concurrent runs,
cross-source rate limits, and real local Auth/PostgREST/Storage/Edge plumbing with
mocked providers. No test uses real email or a live job-provider API.

Headless Edge checks use mocked Supabase at 360/375/390/768/1024/1440px and 932×360
landscape, including profile forms, disabled sources, previews, missing Adzuna
configuration, Phase 4 regression flows, touch targets, public-only caches, and
session-only localStorage. Settings screenshots at 390px and 1440px were visually
inspected. This is not real-device, Safari, screen-reader, hosted, or live-provider
acceptance. The existing large frontend chunk warning is non-blocking. The design
detector reported existing palette-documentation advisories, no changed-TSX issue.

| Area | Files added or changed |
| --- | --- |
| Migration/schema | `supabase/migrations/20261014000700_broad_discovery.sql`, `supabase/migrations/20261014000800_discovery_checkpoints.sql` (new) |
| Shared backend | `supabase/functions/_shared/alerts.ts`, `connectors.ts`, `search.ts` (new); `discovery.ts`, `service.ts`, `runtime.ts`, `scheduler.ts` |
| Frontend | `src/workspace/SearchSettings.tsx` (new); `SourceSettings.tsx`, `DiscoveryStatus.tsx`, `JobsPage.tsx`; `src/lib/discovery.ts`, `src/App.css` |
| Unit/UI fixtures | `tests/broad-discovery.test.ts`, `tests/fixtures/alerts.ts` (new); `tests/discovery-ui.test.tsx`, `tests/import-service.test.ts`, `tests/app.test.tsx` |
| Database tests | `supabase/tests/phase6.test.sql` (new) |
| Integration/browser/PWA | `scripts/check-local-scheduler.mjs`, `scripts/fixtures/scheduler-edge.ts`, `scripts/check-browser.mjs`, `scripts/verify-pwa.mjs` |
| Documentation/hygiene | `PHASE6.md` (new), `README.md`, `PRODUCT.md`, `DESIGN.md`, `.gitignore` (generated local fixture directories) |

The existing application code, Gmail callback, Phase 1–5 migrations, package
dependencies, and Cron configuration were not changed. The small existing login
test adjustment waits for asynchronous owner authorization before asserting it.
