---
name: JobPilot
description: A light, practical personal job-search workspace.
colors:
  background: "#f6f8f6"
  surface: "#fff"
  text: "#202b27"
  muted: "#59675f"
  border: "#dce4de"
  green: "#246344"
  green-soft: "#eaf3ed"
---

# Design System: JobPilot

## Overview

Phase 1 uses plain CSS and Lucide icons for a professional, readable productivity
workspace. Restrained green accents support account and setup information. The
implementation in `src/index.css`, `src/App.css`, and `src/App.tsx` is the reference.

This document reflects source inspection. Browser/device visual verification remains
manual; no browser connection was available. DOM checks do not verify visual layout
or screen-reader output.

## Colors

Green identifies actions, links, and ready states. Soft green marks active navigation
and successful status. Dark text and muted secondary text sit on a pale background
with white surfaces and light borders. Errors use red text, a pale red fill, and
explicit messages; status is never communicated through color alone.

## Typography

The implementation uses Segoe UI with system sans-serif fallbacks. Body and inputs
are 16px with a 1.6 body line height. Page headings are 32px, increasing to 40px at
640px, with weight 650 and a 1.18 line height. Section headings use 1.2rem; item
titles use 1rem. Supporting text is smaller and muted. Long account values wrap.

## Layout

Mobile-first, single-column content has 20px horizontal gutters and a maximum outer
width of 1180px. Gutters become 32px at 640px, 40px at 900px, and 64px at 1200px.
Below 900px, a compact header and four-item bottom navigation frame the workspace;
content reserves 110px plus the bottom safe-area inset. From 900px, a fixed 248px
sidebar replaces mobile navigation and scrolls vertically on short viewports; its
children retain their size. Entry screens center a panel up to 440px wide.
Checklist badges move beside their content at 640px; settings badges do so at 1200px.

## Elevation & Depth

White surfaces and thin borders separate content without decorative shadows.

## Shapes

Panels have 14px corners; buttons, inputs, and navigation items use 8px corners.
Status badges use a compact 6px radius. Lucide line icons accompany readable labels.

## Components

- Buttons have a 48px minimum height; inputs have a 50px minimum height. Primary
  buttons are green; secondary buttons are white with an outline. Buttons deepen
  to green on hover or press. Busy controls show loading text and disable input.
- Navigation includes icons, labels, and a soft green active state. Bottom navigation
  links have a 56px minimum height; desktop links have a 48px minimum height.
- Bordered panels contain checklist rows, account settings, or centered empty states.
  Status badges distinguish ready features from unavailable ones using text.
- Forms use explicit labels, announced errors and loading states, and focused login
  error messages. Keyboard focus uses a 3px green outline. A skip link and route
  focus transfer support navigation. Reduced-motion styles disable motion.

## Do's and Don'ts

- Do preserve readable contrast, wrapping account text, visible keyboard focus, and
  comfortable touch targets when extending the interface.
- Do describe unavailable features through honest setup and empty states.
- Don't add decorative metrics, pretend controls, or visual claims that imply future
  functionality is already available.

## Phase 2 extension and verification

Profile and Resumes extend the existing light/green system without replacing it.
They are reached from Settings and the dashboard, retaining the four-item mobile
navigation. Profile fieldsets group contact, professional background, and job
preferences; paired fields become two columns at 640px. Textareas and selects keep
16px input text, visible labels, errors, and native keyboard behavior. Checkbox
labels have 48px targets. Resume names wrap; actions wrap into multiple rows.
Offline and update notices reuse the existing soft-green status colors.

Headless Edge rendered the production build at 360, 375, 390, 768, 1024, and 1440px,
plus 932×360 landscape, with mocked Supabase data. Profile and resume screenshots
were inspected at 390 and 1440px. This supersedes the Phase 1 no-browser limitation
for those surfaces only; it does not verify real phone installation, Safari, screen
readers, or hosted behavior. The mechanical detector reported palette-documentation
advisories for existing secondary/border/error colors, not layout failures.
