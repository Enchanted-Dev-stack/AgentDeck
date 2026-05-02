# UI/UX Direction

## Direction: Local Ops Deck

AgentDeck should feel like a local developer operations desk: dense, fast, inspectable, keyboard-native, and trustworthy.

## Visual Language

- Dark tactical interface.
- Square panels and hard grid lines.
- Cabinet Grotesk for main headings, pane titles, and major workspace labels.
- Outfit for body copy, forms, lists, and normal interface text.
- Monospace typography only for terminal output, pane IDs, command labels, telemetry, and code-like metadata.
- Pane IDs like `TERM-01`, `DOC-02`, `MEM-03`.
- Rare meaningful accent colors.
- No generic SaaS cards, pastel gradients, glassmorphism, or confetti.
- Icons must come from Hugeicons Rounded. Use the shared AgentDeck icon wrapper instead of importing mixed icon libraries directly.

## Typography

- Display/title font: Cabinet Grotesk.
- Body/UI font: Outfit.
- Data/terminal font: JetBrains Mono, IBM Plex Mono, Consolas, or monospace fallback.
- Headings should use deliberate weights: 700-900 for major labels, 600-700 for pane and section titles.
- Body text should default to 400-500 with compact but readable line heights.
- Do not rely on browser default font sizes for app surfaces.

Cabinet Grotesk font files are not committed until the redistribution license is confirmed. The app should prefer a local Cabinet Grotesk installation and keep an asset path ready for licensed font files.

## Icons

- Use Hugeicons Rounded only.
- Prefer free stroke-rounded icons from `@hugeicons/core-free-icons` unless a licensed Pro package is explicitly approved.
- Icons should be rendered through an AgentDeck wrapper to enforce size, stroke width, accessibility labels, and color behavior.
- Do not mix Lucide, Heroicons, Radix Icons, Font Awesome, or ad hoc SVGs into product UI without a documented exception.

## App Shell

```text
Top command rail: workspace, path, branch, MCP status
Left dock: saved workspaces, docs, memory, MCP servers
Main grid: terminals, notes, docs, logs
Right deck: todos, context, memory references
Bottom event strip: MCP calls, terminal exits, file events
```

## Microinteractions

- Pane focus uses a thin scan pulse.
- Command success/failure stamps the pane header.
- Saving a layout shows a mechanical `LAYOUT SAVED` stamp.
- Completing a todo applies a timestamp stamp.
- Capturing memory compresses source text into a vault row.

## Accessibility

- WCAG AA contrast minimum.
- Reduced motion disables scanlines, flicker, and animated reveals.
- Keyboard resizing and navigation for panes.
- Visible focus rings.
- Color is never the only status indicator.

## Verification

- Every feature implementation should include automated verification when possible: typecheck, tests, build, and a relevant smoke test.
- If automated smoke testing is not possible, document the manual test steps and the specific behavior the user should verify.
