---
version: alpha
name: Lobi Midnight
description: Cool dark-blue theme for Lobi — a placeholder palette, meant to be swapped out. Shape/type/elevation are the more durable part of the identity.
colors:
  primary: "#132445"
  secondary: "#7690B3"
  tertiary: "#3B82F6"
  neutral: "#070B14"
  neutral-container: "#101826"
  on-primary: "#E7ECF5"
  on-tertiary: "#030A16"
  success: "#22C55E"
  danger: "#EF4444"
typography:
  h1:
    fontFamily: Space Grotesk
    fontSize: 3rem
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.02em
  h2:
    fontFamily: Space Grotesk
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 1rem
    lineHeight: 1.5
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 0.75rem
    fontWeight: 600
    letterSpacing: 0.08em
  code:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: 600
rounded:
  sm: 8px
  md: 14px
  lg: 25px
  full: 999px
spacing:
  sm: 8px
  md: 16px
  lg: 24px
components:
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.full}"
    typography: "{typography.label-caps}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "#5B9DFB"
    textColor: "{colors.on-tertiary}"
  card:
    backgroundColor: "{colors.neutral-container}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
  input:
    backgroundColor: "{colors.neutral-container}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  badge:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.full}"
    typography: "{typography.label-caps}"
---

## Overview

Cool, dark-blue "midnight lobby" mood — a near-black navy backdrop with one
vivid azure accent driving every interaction, a geometric display face for
anything that announces itself (titles, buttons, tags), and a quiet body
face for everything you actually read. Placeholder color values: swap the
hexes whenever the real palette is decided. The type, shape, and elevation
choices are meant to outlast that — they're what makes this look like
*Lobi* rather than a generic dark shadcn theme, independent of hue.

## Colors

Rooted in a near-black navy background with one bright accent driving all
interaction, and a deep navy / cool slate pair for chrome and secondary text.

- **Primary (#132445):** Deep navy — headline text, panel chrome, focus rings.
- **Secondary (#7690B3):** Cool slate-blue — borders, captions, metadata, muted labels.
- **Tertiary (#3B82F6):** Vivid azure — the sole driver for interaction: buttons, links, active states.
- **Neutral (#070B14):** Near-black midnight — page background.
- **Neutral container (#101826):** One step up from neutral — cards, panels, inputs.
- **On-primary (#E7ECF5):** Off-white text for use on dark surfaces (primary, neutral, neutral-container).
- **On-tertiary (#030A16):** Near-black text for use on the bright azure accent, to keep contrast high.
- **Success (#22C55E) / Danger (#EF4444):** Status accents for game outcomes — win/correct vs. eliminated/error.

## Typography

Two faces carry the whole UI, plus a monospace for anything that's a code
or a count rather than prose:

- **Space Grotesk (display):** H1/H2, card titles, button labels, badges — anything that's an interface element or a moment, not a paragraph. Geometric and a little technical; it's what gives buttons and headings their identity instead of reading as default system sans.
- **Inter (body):** Paragraphs, descriptions, chat text, settings copy — optimized for reading at small sizes, deliberately quiet next to the display face.
- **JetBrains Mono (code):** Lobby codes, step numbers, board coordinates — anywhere a fixed-width glyph makes a value easier to scan or compare.
- **Label caps:** Space Grotesk, semibold, wide letter-spacing, small size — the treatment for badges and short status tags specifically, not general emphasis. Uppercase is deliberately *not* part of this token: badges here carry real Turkish sentences ("Rakip aldı", "İzliyor"), and CSS `text-transform: uppercase` mis-cases Turkish dotted/dotless i (lowercase `i` → `I` instead of `İ`) unless every rendering engine honors `lang="tr"` for casing, which isn't reliable — so the distinction comes from weight/tracking/face, not case.

## Layout

Spacing scale is small (8px), medium (16px), large (24px) — this already
matches Tailwind's default `gap-2`/`gap-4`/`gap-6` rhythm, so no custom
spacing scale had to be introduced; components stay on that rhythm by
default rather than by convention alone.

## Elevation & Depth

Two shadow tiers, both tinted with the accent color instead of flat black,
so elevated surfaces read as *lit from the accent* rather than just "darker
box, drop shadow":

- **Card elevation** (`shadow-card`): a soft, wide, accent-tinted shadow under panels and cards — enough separation from the background to read as a surface, without a hard edge.
- **Glow** (`shadow-glow` / `shadow-glow-sm`): a tight accent-colored ring plus a soft bloom, used on the primary button's resting/hover states — the one place on screen that should visibly emit light.

## Shapes

Rounding scale: small (8px, tight inline controls), medium (14px, the base
corner unit — inputs, small chips), large (25px, cards and panels), and full
(999px — a true pill). Buttons and badges are always full/pill rather than
softly-rounded rectangles: it's a small, consistent tell that something is
interactive, distinct from the softer large-radius panels holding it.

## Components

- **button-primary:** Azure background, near-black text, full pill shape, label-caps typography (tracked, semibold, no case transform — see the note above). The only saturated, glowing element most screens show, so it should read as the one thing to click.
- **badge:** Same pill + label-caps treatment as button-primary, at rest rather than glowing — a tag reads as "labeled," a button reads as "actionable."
- **card:** Neutral-container background, off-white text, large rounded corners, card elevation. Cards sit one shade lighter than the page and float on the tinted shadow so panels register as surfaces, not just floating text.
- **input:** Same surface as card, medium rounding (tighter than a card, since it's a control, not a container), with secondary-colored borders for definition without adding another color.

## Do's and Don'ts

- Do keep the azure accent (`tertiary`) reserved for interactive elements only — if everything is azure, nothing reads as clickable.
- Do use `on-primary` / `on-tertiary` for text rather than picking new whites/blacks ad hoc, so contrast stays consistent everywhere.
- Do keep buttons and badges pill-shaped and cards large-radius-rectangular — mixing the two shape languages on the same element type is the fastest way back to looking generic.
- Don't introduce a second saturated accent color without removing this one first — the palette is built around exactly one.
- Don't use pure black or pure white — `neutral` and `on-primary` are intentionally slightly tinted navy/off-white.
- Don't set display-face (Space Grotesk) type on paragraph-length text, and don't set body-face (Inter) type on buttons/badges/titles — the split between "moments" and "reading" is the point.
