# JobPilot

<!-- impeccable:product-schema 1 -->

## Platform

web

## Purpose and owner

A personal job-search assistant for one owner, intended to bring job discovery,
application preparation, Gmail delivery, and application tracking into one workspace.

## Current implementation: Phase 6

Supabase email/password authentication for a pre-created account, protected routes,
a responsive application shell, administrator-appointed single-owner RLS, a persistent
profile, private PDF resumes, and a privacy-safe installable PWA shell. Gmail
OAuth, one confirmed Gmail label, configured Greenhouse boards, manual job entry,
import history, conservative parsing, deterministic preference matching, and
save/dismiss/review state extend the workspace.

Saved or reviewed jobs can become owner-only application drafts. The owner enters
and verifies the employer recipient, edits the subject and body, and selects a
private resume PDF. Final review shows the sending account, recipient, exact email,
selected PDF name and size, and send filename. Sending requires fresh Gmail sending
consent, a final review checkbox, and an explicit send action for each application.
Gmail acceptance is recorded without claiming employer delivery or readership.
Uncertain send outcomes require manual reconciliation in Gmail and are not retried
automatically. Applications submitted outside JobPilot can be recorded manually.

Unsaved application edits stay in memory; saved drafts use backend ownership checks
and RLS. Gmail tokens and attachment handling stay on the backend. Discovery can
run hourly through an independently authenticated Supabase Edge Function and Cron,
only after the owner enables automation. It defaults off and reads only confirmed,
enabled sources. The owner can pause it, see Philippine-time schedules and source
results, and review imported jobs/history on the dashboard. Applications remain
owner-triggered; AI preparation and automated submissions are not implemented.
Hosted setup remains administrator-run after review; see PHASE5.md for scheduler
setup and verification boundaries, and PHASE4.md for the application workflow.

Phase 6 adds owner-only search profiles, conservative alert parsing and confidence,
public Lever/Ashby boards, optional server-secret Adzuna searches, cross-source
deduplication and provenance, explainable profile scores, source health and previews,
and bounded resumable work through the existing hourly scheduler. New public sources
and profiles start disabled. Adzuna has no Philippine market; overseas eligibility
remains unverified. See PHASE6.md for limitations and the pending hosted rollout.

## Intended complete product (future work)

- Support AI-assisted application preparation using explicitly approved data.
- Extend the installable app with future online job-search workflows.

AI provider, future application automation approval rules, and future database policies
remain design decisions for later phases. Discovery includes manual entry, one confirmed Gmail label, configured public
Greenhouse/Lever/Ashby boards, and optional Adzuna country-market searches.

## Constraints

React, TypeScript, Vite, Supabase Auth/Postgres/Storage/Edge Functions/Cron, and
Vercel hosting. One owner; no public registration UI. Browser routing is a UX
boundary, not backend authorization. Private data uses backend ownership checks
and RLS. Gmail secrets never enter browser code. No real application emails during
development or tests. Hosted migrations and deployment require explicit approval.
PWA caching contains only the public shell, updates require a prompt, and private
unsaved drafts are never persisted in browser storage.

## Interface commitments

Professional, light, readable, restrained green accent; desktop sidebar and mobile
bottom navigation. Support 360px widths, keyboard use, visible focus, accessible
forms, comfortable touch targets, and reduced motion. Show only truthful status.
