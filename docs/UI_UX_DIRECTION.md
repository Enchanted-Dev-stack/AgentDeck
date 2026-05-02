# UI/UX Direction

## Direction: Local Ops Deck

AgentDeck should feel like a local developer operations desk: dense, fast, inspectable, keyboard-native, and trustworthy.

## Visual Language

- Dark tactical interface.
- Square panels and hard grid lines.
- Monospace-heavy typography.
- Pane IDs like `TERM-01`, `DOC-02`, `MEM-03`.
- Rare meaningful accent colors.
- No generic SaaS cards, pastel gradients, glassmorphism, or confetti.

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
