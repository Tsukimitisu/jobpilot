---
name: responsive-web-design
description: Use this skill whenever implementing, auditing, or fixing responsive layouts for this React + Vite + TypeScript + Tailwind CSS v4 portfolio site, especially for phone and tablet viewports. Trigger on any mention of "responsive", "mobile view", "tablet view", "breakpoints", "mobile navbar", "touch targets", "media query", "doesn't look right on mobile/phone/tablet", or when writing/editing any component (Navbar, Hero, buttons, cards, SideRays background, GSAP/Framer Motion animations, Lenis scroll) that will render on small screens — even if the user doesn't say "responsive" explicitly. Also trigger before shipping any new section or page to catch responsiveness issues proactively.
---

# Responsive Web Design — Phone & Tablet

This skill governs how responsiveness is implemented across the portfolio site. It exists because this site is animation-heavy (GSAP, Framer Motion, Lenis) and hover-dependent (dropdowns, button glows, sub-link arrows) by default — patterns that break or actively hurt UX on touch devices if ported over unchanged. The goal is not just "does it fit the screen" but "does it feel native to a phone/tablet."

## 0. Mandatory Context-Gathering (do this before writing any code)

Do not guess at the current state. Before implementing or fixing anything:

1. **Read the actual component file(s)** involved — don't assume from memory or from this doc what classes/breakpoints are already present.
2. **Check `tailwind.config` / the `@theme inline` block in `index.css`** for any custom breakpoints already defined. Tailwind v4's inline theme config may have overridden defaults — verify before assuming standard `sm/md/lg/xl`.
3. **Check for existing `prefers-reduced-motion` handling** in GSAP/Framer Motion setup — don't duplicate or conflict with it.
4. **Check whether Lenis is already conditionally disabled on touch/mobile** — search for `Lenis(` instantiation and any viewport/user-agent guards around it.
5. **If a specific component is being fixed (not built new)**, screenshot or describe the current broken behavior at the target breakpoint before proposing a fix — confirm the actual failure mode (overflow, overlap, unreadable text, dead hover state, etc.) rather than applying a generic fix.

## 1. Breakpoint System

Mobile-first. Base (unprefixed) styles = phone. Add complexity upward.

| Label | Range | Tailwind prefix | Represents |
|---|---|---|---|
| Phone (small) | 0–374px | (base) | iPhone SE / small Android |
| Phone (standard) | 375–639px | (base, use `min-[375px]:` sparingly) | iPhone 12–15, most Android |
| Tablet (portrait) | 640–767px | `sm:` | Large phones / small tablets landscape |
| Tablet | 768–1023px | `md:` | iPad portrait |
| Tablet (landscape) / small laptop | 1024–1279px | `lg:` | iPad landscape, small laptops |
| Desktop | 1280px+ | `xl:` | Standard desktop |

Rules:
- Never write a desktop-first override (`base: desktop styles`, then `max-md:` to shrink it). Always start from the smallest layout and scale up with `sm:`/`md:`/`lg:`.
- If a component needs a breakpoint Tailwind doesn't have by default, use an arbitrary variant (`min-[820px]:`) rather than editing the global config, unless the change is genuinely reusable elsewhere.
- Test at 375px, 390px, 768px, and 1024px minimum — these cover the real device clusters above, not just "phone" and "desktop."

## 2. Component-Specific Rules

### Navbar
- The current dropdown pattern (hover-triggered, `scale: 0.95 → 1`) is a **desktop-only interaction** — hover doesn't exist on touch. Below `md:`, dropdowns must become tap-to-expand (accordion) or move into a full mobile drawer/sheet triggered by a hamburger icon (`lucide-react` `Menu`/`X`, already in the icon set).
- The navbar's scroll-based show/hide behavior should stay, but on mobile, prefer always-visible-but-condensed over hide/show if the drawer is open — never let the drawer close because the navbar hid itself mid-interaction.
- Sub-link hover translations (`translate-x-0.5`) and fading arrows (`→`) need a **tap/active-state equivalent** — e.g. apply the same transform on `:active` or on the accordion's `open` state, not only `:hover`.
- Minimum tap target: 44×44px (Apple HIG) / 48×48dp (Material) for every nav link, icon button, and dropdown trigger. Padding counts — the visible icon can be 20px as long as the tappable area around it isn't smaller than the minimum.

### SideRays background effect
- This is a fixed, animated `z-0` background. On phone/tablet, animated backgrounds are a common source of jank and battery drain, and users notice it far more on a phone in their hand than on a desktop monitor.
- At `md:` and below: reduce animation complexity (lower frequency/amplitude, or swap to a static gradient) unless a perf check confirms it holds 60fps on a mid-tier device profile.
- Always respect `prefers-reduced-motion: reduce` — pause or replace with a static version regardless of breakpoint.

### Hero text effects (SplitText, TextType, BlurText)
- Character-by-character GSAP animations (`SplitText`) are more expensive per character. On phone, either keep duration/stagger the same (character count is fixed, so cost is fixed) but double-check first-load performance on throttled CPU — this is more about frame budget than layout.
- `TextType` (typewriter): verify the cursor and text don't cause horizontal overflow at narrow widths — long phrases like "Software Engineer" need `whitespace-nowrap` guarded by a container that can actually fit it, or a smaller font-size step at phone width.
- If a hero title wraps awkwardly on phone (e.g. splits a name mid-word), use responsive `text-*` sizing (e.g. `text-3xl sm:text-4xl md:text-5xl lg:text-6xl`) rather than a fixed size — don't let `SplitText` character animation be the thing fighting for layout space.

### Buttons / CTAs (`.gradient-bg`, `.gradient-border-dark`, `hover-gradient-blue`)
- `hover-gradient-blue` is hover-only by name and intent. On touch devices this state either never triggers or gets "stuck" after tap (iOS quirk: `:hover` can persist after touch). Add an explicit `:active` state with the same visual treatment, and consider a `@media (hover: hover)` guard so the hover-only glow doesn't apply on touch at all.
- Pill buttons (`rounded-full`, `tracking-wider`) stay visually consistent across breakpoints, but check horizontal padding at phone width — uppercase tracked text needs more room proportionally; don't let CTAs truncate or wrap into two lines unintentionally.

### Custom scrollbar / modals
- The custom thin scrollbar (`.modal-scrollbar`) is a desktop mouse-precision affordance. On touch, native momentum scrolling inside a modal matters more than the scrollbar's visual style — make sure `-webkit-overflow-scrolling: touch` (or the modern equivalent) isn't blocked, and that modal panels don't trap scroll in a way that fights the outer page/Lenis scroll on mobile.

### Lenis smooth scroll
- Lenis on touch devices can fight the OS's native momentum scroll and feel laggy/rubbery. Confirm whether Lenis is already disabled or set to a touch-appropriate config (`smoothTouch: false` or a mobile-specific instance) — if not, that's a responsiveness bug even though it's not visual.
- Never let Lenis' scroll-hijacking interfere with pinch-to-zoom or native iOS overscroll bounce; test on an actual device or device emulation, not just a resized desktop browser window.

## 3. Typography

- Use fluid or stepped responsive sizing, not one fixed size scaled down arbitrarily. Prefer Tailwind's responsive prefixes over inline `clamp()` unless a genuinely fluid (non-stepped) scale is needed for a hero headline.
- Body text (`Montserrat`) should not go below `16px` (`text-base`) on phone for paragraph copy — smaller triggers mobile Safari's auto-zoom-on-input behavior in forms and hurts readability.
- Heading fonts (`NeutralFace`, `NeutralFaceBold`, `Threat`) often have wide letterforms — verify line-height and letter-spacing don't need adjusting at smaller sizes; what looks premium at 64px can look cramped or overly loose at 28px.
- Respect the existing dark/light mode text tokens (`#F9F9F9` / `#1a1a1a`) — responsiveness changes layout and size, never color/contrast, unless a breakpoint-specific background genuinely requires it.

## 4. Layout & Spacing

- Convert multi-column grids to single-column stacks below `md:` by default (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`), not by hiding columns.
- Reduce section vertical padding at phone width — desktop spacing (`py-24`, `py-32`) often reads as excessive dead space on a phone screen; step it down (`py-12 sm:py-16 md:py-24 lg:py-32`).
- Card/overlay backgrounds (`rgba(8,10,15,0.44)` dark / `rgba(255,255,255,0.7)` light) and their borders should keep the same opacity values across breakpoints — only geometry (padding, radius, width) should respond to screen size, not the theme itself.
- Avoid fixed pixel widths on any content container; use `max-w-*` with `w-full` so containers shrink gracefully instead of causing horizontal scroll.

## 5. Touch & Interaction General Rules

- Anything wrapped in `:hover` needs an explicit fallback: `:active` for the pressed state, or `@media (hover: hover) and (pointer: fine)` to scope hover-only effects to devices that actually support hover.
- Minimum 44×44px tap targets, with at least 8px spacing between adjacent interactive elements to avoid mis-taps.
- Disable or shorten transition durations that were tuned for mouse hover speed if they now trigger on tap — a 300ms hover-in animation feels sluggish as a tap response; consider ~150ms for tap-triggered equivalents.

## 6. Testing Checklist

Run through this before considering a component/page "responsive-complete":

- [ ] 375px (iPhone SE) — no horizontal scroll, no overlapping text, nav usable
- [ ] 390–430px (modern iPhone/Android) — hero text doesn't wrap awkwardly
- [ ] 768px (iPad portrait) — verify layout doesn't just look like a stretched phone view; tablet often deserves its own `md:` treatment, not phone-styles-scaled-up
- [ ] 1024px (iPad landscape) — check whether hover-dependent UI is reachable (iPads support touch primarily, some support pointer/mouse)
- [ ] Rotate portrait ↔ landscape on a tablet-sized viewport — layout shouldn't break
- [ ] `prefers-reduced-motion: reduce` — animations pause/simplify appropriately
- [ ] Throttled CPU (Chrome DevTools 4x–6x slowdown) — GSAP/Lenis effects still feel acceptable, not janky
- [ ] Real device or device emulation for at least one test, not resized desktop Chrome alone — desktop resize doesn't simulate touch, `hover: none`, or mobile Safari quirks

## 7. What NOT to Do

- Do NOT ship any hover-only interaction (dropdown, glow, arrow reveal) without a tap/active equivalent below `md:`.
- Do NOT use `max-width` media queries / desktop-first overrides — this codebase is mobile-first; work upward from the base styles.
- Do NOT disable pinch-to-zoom or set `user-scalable=no` / `maximum-scale=1` on the viewport meta tag to "fix" a layout issue — that's an accessibility violation and papers over the real bug.
- Do NOT leave heavy animated backgrounds (SideRays) running unmodified on phone without checking actual frame performance — assume nothing, measure it.
- Do NOT shrink body text below 16px to make something "fit" — fix the layout instead.
- Do NOT edit global Tailwind theme breakpoints to solve a single component's problem — use scoped/arbitrary variants unless the change is genuinely global.
- Do NOT skip testing at 768px and 1024px under the assumption that "if it works on phone and desktop, tablet is fine" — tablet-specific bugs (awkward mid-sized grids, orphaned hover states) are common and easy to miss.
- Do NOT touch color tokens, border rgba values, or font families when the task is purely responsiveness — that's a branding/theming change, out of scope here.

## 8. Quick Reference Patterns

**Responsive grid (stack → 2-col → 3-col):**
```jsx
<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
```

**Hover-safe interactive class:**
```css
@media (hover: hover) and (pointer: fine) {
  .hover-gradient-blue:hover { /* existing hover treatment */ }
}
.hover-gradient-blue:active { /* same visual treatment, tap-triggered */ }
```

**Responsive heading scale:**
```jsx
<h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl">
```

**Mobile nav drawer trigger (pairs with existing lucide-react icons):**
```jsx
<button
  className="flex h-11 w-11 items-center justify-center md:hidden"
  aria-label="Toggle menu"
  onClick={toggleDrawer}
>
  {isOpen ? <X size={22} /> : <Menu size={22} />}
</button>
```

**Reduced-motion guard for GSAP:**
```js
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!prefersReducedMotion) {
  // run SplitText / TextType / SideRays animation
} else {
  // set final state directly, no animation
}
```
