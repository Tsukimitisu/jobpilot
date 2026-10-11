# JobPilot

<!-- impeccable:product-schema 1 -->

## Platform

web

## Purpose and owner

A personal job-search assistant for one owner, intended to bring job discovery,
application preparation, Gmail delivery, and application tracking into one workspace.

## Current implementation: Phase 1

Supabase email/password authentication for a pre-created account, protected routes,
a responsive application shell, honest setup and empty states, and Vercel deployment
preparation. No jobs are imported and no application emails are sent.

## Intended complete product (future work)

- Discover jobs from configured sources and track applications.
- Store private resumes and support AI-assisted application preparation.
- Connect Gmail using backend-held credentials and refresh tokens.
- Run scheduled work through Supabase Edge Functions and Cron while the laptop is off.
- Provide a mobile-friendly installable web app, with PWA behavior added later.

Source selection, AI provider, application approval rules, schedules, and future
database policies remain design decisions for later phases.

## Constraints

React, TypeScript, Vite, Supabase Auth/Postgres/Storage/Edge Functions/Cron, and
Vercel hosting. One owner; no public registration UI. Browser routing is a UX
boundary, not backend authorization. Future data requires backend ownership checks
and RLS. Gmail secrets never enter browser code. No real application emails during
development or tests. Phase 1 makes no hosted configuration or database changes.

## Interface commitments

Professional, light, readable, restrained green accent; desktop sidebar and mobile
bottom navigation. Support 360px widths, keyboard use, visible focus, accessible
forms, comfortable touch targets, and reduced motion. Show only truthful status.
