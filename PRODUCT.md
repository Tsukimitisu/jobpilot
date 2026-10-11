# JobPilot

<!-- impeccable:product-schema 1 -->

## Platform

web

## Purpose and owner

A personal job-search assistant for one owner, intended to bring job discovery,
application preparation, Gmail delivery, and application tracking into one workspace.

## Current implementation: Phase 3

Supabase email/password authentication for a pre-created account, protected routes,
a responsive application shell, administrator-appointed single-owner RLS, a persistent
profile, private PDF resumes, and a privacy-safe installable PWA shell. Read-only Gmail
OAuth, one confirmed Gmail label, configured Greenhouse boards, manual job entry,
import history, conservative parsing, deterministic preference matching, and
save/dismiss/review state extend the workspace. Hosted setup is owner-run after
review; see PHASE3.md. No application emails, submissions, or scheduled work run.

## Intended complete product (future work)

- Prepare and track applications from reviewed jobs.
- Support AI-assisted application preparation using explicitly approved data.
- Extend the read-only Gmail connection only with explicit approval of sending.
- Run scheduled work through Supabase Edge Functions and Cron while the laptop is off.
- Extend the installable app with future online job-search workflows.

AI provider, application approval rules, sending permissions, schedules, and future
database policies remain design decisions for later phases. Phase 3 sources are
limited to manual entry, one selected Gmail label, and configured Greenhouse boards.

## Constraints

React, TypeScript, Vite, Supabase Auth/Postgres/Storage/Edge Functions/Cron, and
Vercel hosting. One owner; no public registration UI. Browser routing is a UX
boundary, not backend authorization. Private data uses backend ownership checks
and RLS. Gmail secrets never enter browser code. No real application emails during
development or tests. Phase 1 makes no hosted configuration or database changes.

## Interface commitments

Professional, light, readable, restrained green accent; desktop sidebar and mobile
bottom navigation. Support 360px widths, keyboard use, visible focus, accessible
forms, comfortable touch targets, and reduced motion. Show only truthful status.
