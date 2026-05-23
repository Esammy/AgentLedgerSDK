---
name: AgentLedger Trust Layer
colors:
  surface: '#00142a'
  surface-dim: '#00142a'
  surface-bright: '#283a51'
  surface-container-lowest: '#000f21'
  surface-container-low: '#081c32'
  surface-container: '#0c2036'
  surface-container-high: '#182b41'
  surface-container-highest: '#23364d'
  on-surface: '#d2e4ff'
  on-surface-variant: '#bbc9c7'
  inverse-surface: '#d2e4ff'
  inverse-on-surface: '#1f3148'
  outline: '#859492'
  outline-variant: '#3c4948'
  surface-tint: '#4ddbd3'
  primary: '#4ddbd3'
  on-primary: '#003735'
  primary-container: '#1abcb5'
  on-primary-container: '#004643'
  inverse-primary: '#006a66'
  secondary: '#7bd0ff'
  on-secondary: '#00354a'
  secondary-container: '#00a6e0'
  on-secondary-container: '#00374d'
  tertiary: '#8bd6b4'
  on-tertiary: '#003827'
  tertiary-container: '#6db797'
  on-tertiary-container: '#004732'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#6ff7ef'
  primary-fixed-dim: '#4ddbd3'
  on-primary-fixed: '#00201e'
  on-primary-fixed-variant: '#00504c'
  secondary-fixed: '#c4e7ff'
  secondary-fixed-dim: '#7bd0ff'
  on-secondary-fixed: '#001e2c'
  on-secondary-fixed-variant: '#004c69'
  tertiary-fixed: '#a6f2cf'
  tertiary-fixed-dim: '#8bd6b4'
  on-tertiary-fixed: '#002115'
  on-tertiary-fixed-variant: '#00513a'
  background: '#00142a'
  on-background: '#d2e4ff'
  surface-variant: '#23364d'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  body-base:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: -0.005em
  body-bold:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.005em
  terminal-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: '0'
  terminal-bold:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '700'
    lineHeight: 20px
    letterSpacing: '0'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-padding-sm: 8px
  container-padding-md: 16px
  container-padding-lg: 24px
  gutter: 16px
  sidebar-width: 260px
  inspector-width: 320px
  max-width: 1440px
---

## Brand & Style

The design system is engineered to project absolute technical authority, cryptographic trust, and clinical precision. It is a high-performance environment designed for developers who oversee autonomous AI agents. The aesthetic is a sophisticated fusion of **Minimalism** and **Corporate/Modern** styles, drawing direct inspiration from the refined utility of Vercel, the density of Linear, and the reliability of Stripe.

The visual narrative rejects "hacker" tropes like scanlines or neon glows in favor of razor-sharp hairline borders, deep obsidian surfaces, and a rigorous adherence to a grid. The UI feels like a high-fidelity control deck—silent, vigilant, and instantly responsive. It prioritizes information density and logical flow, ensuring that a "killswitch" or a "policy violation" is signaled with professional gravity rather than visual noise.

## Colors

The palette is optimized for long-duration technical monitoring in dark environments. 

- **Primary (Signal Teal):** Used for verified states, primary actions, and cryptographic confirmations.
- **Secondary (Sky Blue):** Dedicated to information, schema parameters, and documentation.
- **Neutral Foundation:** A hierarchy of deep navy tones (`#0D2137` through `#183B61`) creates depth through value shifts rather than shadows.
- **State Colors:** Success (Mint), Error (Crimson), and Warning (Amber) use soft-washed, high-legibility tints. These are used for status badges, thin alert borders, and state-specific icons.
- **Typography:** Body text is a soft white (`#E2E8F0`) to reduce eye strain while maintaining high contrast against the obsidian background.

## Typography

This system uses a hybrid typographic approach: **Inter** for the interface shell and **JetBrains Mono** for all technical and data-driven content.

- **Inter** handles the structural UI: headings, navigation, and standard descriptive text. It is set with tight tracking to maintain a modern, "engineered" look.
- **JetBrains Mono** is the functional workhorse. It is used for all agent logs, code snippets, SHA hashes, and terminal telemetry. 
- **Label Caps:** Small, uppercase monospaced labels are used for table headers and metadata tags to facilitate rapid scanning of tabular data.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy within a max-width container of 1440px. The interface is divided into functional zones:
- **Navigation Sidebar:** A fixed 260px column for run lists and status filtering.
- **Main Telemetry Deck:** A fluid central area for live log feeds.
- **Contextual Inspector:** A collapsible 320px right-hand panel for deep JSON inspection.

The spacing rhythm is strictly based on a **4px base unit**. Component internal padding is kept tight (8px/12px) to maintain high data density, while external gutters between major sections are wider (24px) to provide clear visual separation. On mobile, the inspector and sidebar collapse into standard drawers, and the terminal feed reflows to prioritize chronological log strings.

## Elevation & Depth

Hierarchy is established through **Tonal Layers** and **Low-contrast Outlines**. 
- **Surfaces:** Depth is created by "lifting" elements with lighter navy values. The background is `#0D2137`, cards are `#122D4B`, and active/hovered states are `#183B61`.
- **Borders:** All containers use a 1px hairline border (`#1E3D5F`). This creates a crisp, structured environment without the need for shadows.
- **Shadows:** Avoid drop shadows entirely. The design relies on the contrast between the surface colors and the precision of the outlines to define boundaries.

## Shapes

The shape language is "Soft" yet disciplined. A base radius of **4px (rounded-sm)** is applied to buttons, cards, and input fields. This slight rounding softens the technical edge just enough to feel professional and modern (like Vercel or Linear) without becoming playful or consumer-focused. Status badges and tags may use a pill-shape for distinct categorization, but all structural containers must remain strictly at the 4px-8px radius range.

## Components

- **Buttons:** Primary buttons are solid Teal with Navy text. Secondary buttons are 1px outlines. The "Killswitch" button is a specific variant using a Crimson border and text, only becoming solid on hover to signal high-intent action.
- **Terminal Feed:** A specialized component with a darker `#081728` background. Logs are rendered in JetBrains Mono with color-coded prefixes (e.g., `[TOOL_CALL]` in Teal, `[ERROR]` in Crimson).
- **Status Badges:** Compact, monospaced tags with a light background tint. For example, a `[VERIFIED]` badge uses a subtle Teal background with 70% opacity.
- **Telemetry Cards:** Flat cards with a `#122D4B` surface and a `#1E3D5F` border. They include a 4px solid left-border accent to indicate the status (Teal for OK, Amber for Gated).
- **Inputs:** Inset boxes using the `surface_low` color. On focus, the border shifts instantly to Signal Teal. Monospace font is mandatory for any input that accepts schema or code.
- **Cryptographic Chain:** A sequence of nodes connected by hairline paths. Path lines "light up" in Mint when `verify()` returns true, providing immediate visual trust.