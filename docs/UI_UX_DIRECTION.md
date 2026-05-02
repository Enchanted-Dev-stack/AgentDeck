# UI/UX Direction

## Direction: Modern Workspace Deck

AgentDeck should feel like a modern, approachable workspace for people coordinating CLI agents and local context. It should be calm, clear, keyboard-native, and friendly enough for daily use without feeling like a game, a terminal skin, or a generic SaaS dashboard.

## Visual Language

- Warm modern app shell with light/dark-ready surfaces.
- Soft outer panels for navigation and shared context.
- Terminal panes remain boxy, precise, and highly legible.
- Cabinet Grotesk for main headings, pane titles, and major workspace labels.
- Outfit for body copy, forms, lists, and normal interface text.
- Monospace typography only for terminal output, pane IDs, command labels, telemetry, and code-like metadata.
- Pane IDs like `TERM-01`, `DOC-02`, `MEM-03`.
- Accent colors are calm and purposeful: blue for active workspace, green for healthy/running, amber for attention, red for destructive/error.
- Avoid heavy terminal cosplay, generic SaaS card piles, glassmorphism, and decorative gradients that do not support hierarchy.
- Icons must come from Hugeicons Rounded. Use the shared AgentDeck icon wrapper instead of importing mixed icon libraries directly.

## Typography

- Display/title font: Cabinet Grotesk.
- Body/UI font: Outfit.
- Data/terminal font: JetBrains Mono, IBM Plex Mono, Consolas, or monospace fallback.
- Headings should use deliberate weights: 700-900 for major labels, 600-700 for pane and section titles.
- Body text should default to 400-500 with compact but readable line heights.
- Do not rely on browser default font sizes for app surfaces.

Cabinet Grotesk assets live under `apps/desktop/public/fonts/cabinet-grotesk`. Confirm redistribution rights before public release packaging.

## Icons

- Use Hugeicons Rounded only.
- Prefer free stroke-rounded icons from `@hugeicons/core-free-icons` unless a licensed Pro package is explicitly approved.
- Icons should be rendered through an AgentDeck wrapper to enforce size, stroke width, accessibility labels, and color behavior.
- Do not mix Lucide, Heroicons, Radix Icons, Font Awesome, or ad hoc SVGs into product UI without a documented exception.

## App Shell

```text
Top bar: product identity, current workspace, MCP status, command/search
Left rail: saved workspaces and quick sections
Main canvas: draggable/resizable terminal/document panes
Right inspector: todos, context, memory references
Bottom status strip: MCP calls, terminal exits, file events
```

## Microinteractions

- Buttons and workspace rows use subtle scale-on-press feedback.
- Pane focus uses a clear blue ring and elevated header, not a scanline effect.
- Drag handles show grab cursors and small movement affordances.
- Resizer rails brighten on hover/focus.
- Completing a todo should feel instant and calm: checkbox fill, slight text fade, timestamp appears.
- Capturing memory should show a compact confirmation toast/surface, not a theatrical animation.

## Accessibility

- WCAG AA contrast minimum.
- Reduced motion disables scanlines, flicker, and animated reveals.
- Keyboard resizing and navigation for panes.
- Visible focus rings.
- Color is never the only status indicator.

## Verification

- Every feature implementation should include automated verification when possible: typecheck, tests, build, and a relevant smoke test.
- If automated smoke testing is not possible, document the manual test steps and the specific behavior the user should verify.
