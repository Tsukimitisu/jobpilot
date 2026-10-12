# JobPilot

<!-- impeccable:product-schema 1 -->

## Platform

web

## Purpose and owner

A personal job-search assistant for one owner, intended to bring job discovery,
application preparation, Gmail delivery, and application tracking into one workspace.

## Current implementation: Phase 4

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
and RLS. Gmail tokens and attachment handling stay on the backend. Discovery and
application actions are owner-triggered; AI preparation, automated submissions,
and scheduled work are not implemented. Hosted setup remains owner-run after
review; see PHASE4.md for setup and verification boundaries.

## Intended complete product (future work)

- Support AI-assisted application preparation using explicitly approved data.
- Run scheduled work through Supabase Edge Functions and Cron while the laptop is off.
- Extend the installable app with future online job-search workflows.

AI provider, automation approval rules, schedules, and future database policies
remain design decisions for later phases. Sources remain limited to manual entry,
one selected Gmail label, and configured Greenhouse boards.

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
