# JobPilot — Phase 1

Personal job-search workspace built with React, TypeScript, Vite, and Supabase.
Phase 1 implements email/password sign-in, session restoration, protected routes,
responsive navigation, setup guidance, and honest empty screens. No job importing,
Gmail connection, email sending, AI, uploads, scheduled work, database migrations,
PWA installation, or service-worker caching is implemented.

## Local setup (PowerShell)

Use Node.js 24 LTS (the implementation was checked with Node 24.11.0).

1. In `C:\Users\revil\Projects\jobpilot`, run `npm.cmd ci`.
2. If you do not already have `.env.local`, run
   `Copy-Item .env.example .env.local`. Do not overwrite existing configuration.
3. Edit `.env.local` locally with your hosted project URL and **publishable** key:
   - `VITE_SUPABASE_URL=https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<your-public-key>`
4. Use the owner’s pre-created, confirmed email/password user. No public registration
   or password-reset flow is provided. In hosted Supabase Auth configuration, the
   owner should disable public sign-ups and ensure only the intended owner account exists.
   The absence of a sign-up page does not disable Supabase’s registration API.
5. Run `npm.cmd run dev -- --host 127.0.0.1` and open the local URL printed by Vite.
   Restart Vite whenever environment values change.

Only project URLs and publishable keys belong in browser configuration. All VITE_
values are public build inputs. Never add an administrator/service-role/secret key,
Gmail secret, refresh token, or account password to these variables. Legacy anon JWT
keys are intentionally not accepted by this Phase 1 publishable-key configuration.
Secret .env files are ignored; .env.example contains placeholders only.

Missing or malformed values show a setup screen, without echoing values or creating
a fake backend. Valid-looking but incorrect project/key values produce sign-in errors.
Localhost HTTP project URLs are accepted for later local Supabase development.

## Commands

```powershell
npm.cmd run dev
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1
```

Tests use Vitest, Testing Library, and jsdom. Supabase is mocked and network requests
are forbidden in the app tests. Synthetic fixtures never create accounts. The
production application has no mock-backend path. Lint excludes bundled .agents
tooling and generated dist files; the skill files remain intact.

## Phase 1 verification

Implementation check: production build and app lint passed; 38 mocked checks passed
across two test files. The design detector reported no findings. Source review fixed
short-viewport sidebar scrolling; rendered verification of that fix remains manual.

Automated checks cover configuration rejection/redaction, safe redirect destinations,
initial loading, restoration, subscription cleanup under React StrictMode, stale
session-read races, session errors/timeouts, expiry and refresh events, protected
routes, form validation, request failures, sign-out, and screen navigation.

Live hosted Supabase sign-in, actual persistence/refresh/revocation, cross-tab events,
visual phone/desktop checks, screen readers, and Vercel-hosted deep links require
manual verification. Browser discovery returned no available browser during
implementation. DOM tests cannot establish pixel layout or touch behavior.

### Manual acceptance steps

1. Start Vite and open `/jobs` in a private browser window while signed out.
   Expect a brief session-loading state, then `/login`, with no protected content.
2. Submit empty fields and an invalid email. Expect a readable focused error and
   no authentication request. Use an incorrect password once to verify a safe
   credentials error. Do not paste passwords into logs or bug reports.
3. Sign in with the pre-created owner account. Expect the original `/jobs`
   destination. Opening `/` or `/login` while signed in leads to `/dashboard`.
4. Reload `/dashboard`, `/jobs`, `/applications`, and `/settings`; confirm
   session restoration and no flash of the login form.
5. Navigate all four pages. Verify your account, truthful checklist/empty states,
   Gmail **Not connected**, automation **Not implemented**, and no invented totals.
6. Open another tab on the same origin. Sign out from Settings; both tabs should
   return to login when they receive the auth event. Reload and use Back; private
   pages must remain guarded. Sign-out affects this browser session, not all devices.
7. Test network failure while signed out using DevTools Offline. Submit the form;
   expect an actionable error and an enabled retry after the request fails. Restore
   connectivity. For a slow connection, verify the pending button cannot be submitted twice.
8. For expiration, sign in, go offline, and wait past the configured access-token
   lifetime; returning to the tab must hide private pages and ask for sign-in.
   Restore connectivity and verify normal refresh/login recovery. Backend revocation
   follows Supabase token lifetime rules; client route guards are not authorization.
9. Check widths 360, 375, 390, 768, 1024, and 1440px, plus landscape around 932×360.
   Confirm no horizontal scrolling, reachable navigation, readable long emails,
   visible keyboard focus, and content above the bottom bar. Test reduced motion,
   keyboard-only use, 200% zoom, and a phone’s keyboard/safe area.
10. Visit `/missing` and confirm the not-found page with a working return link.
11. To check setup errors without editing your saved credentials, stop Vite and
    launch it with a temporary PowerShell environment override:
    `$env:VITE_SUPABASE_URL='invalid'; npm.cmd run dev`.
    Expect setup guidance without showing the supplied value. Stop Vite, then
    run `Remove-Item Env:VITE_SUPABASE_URL` and restart normally.

## Deployment preparation only

`vercel.json` rewrites SPA paths to index.html. When the owner later chooses to
deploy, use Vercel’s Vite preset, build command `npm run build`, output `dist`,
and set both public environment variables for the intended deployment environment.
Redeploy after changing them. Keep private source environment files out of version
control. Verify direct navigation and reload on every route in the hosted build.

No deployment or hosted Supabase mutation is part of Phase 1. Vite’s preview server
tests the built app locally; it does not verify Vercel’s rewrite behavior.

## Security and implementation notes

The reusable client is in `src/lib/supabase.ts`; authentication lifecycle is in
`src/auth/useAuth.ts`. The app uses Supabase persistence/auto-refresh, synchronous
auth-event callbacks, and subscription cleanup. See
[Supabase auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).
Sign-out uses [local session scope](https://supabase.com/docs/guides/auth/signout).

The authenticated shell is removed on sign-out or expiry and remounted for a new
user, clearing its component state. No job/application cache exists in Phase 1.
Sessions are managed by Supabase in browser storage; shared devices must sign out.
A failed remote sign-out may still clear the local session in the installed SDK.
No raw backend errors, passwords, keys, or tokens are rendered or logged by app code.

Client-side guards protect navigation only. Future private data must use server-side
ownership checks and RLS; an email allowlist in JavaScript is not a security boundary.
See [PRODUCT.md](PRODUCT.md) for intended future scope and [DESIGN.md](DESIGN.md) for
the implemented interface. Stop at Phase 1 before adding future features.

