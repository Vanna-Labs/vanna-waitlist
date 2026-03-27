# Proof-First Landing Reflow Design

## Goal

Refactor the deployed landing page experience so the proof section leads the narrative, the chat demo supports that proof instead of competing with it, and the typing animation no longer causes the chat shell to resize as Vanna responses appear.

## Context

The deployed site on `origin/main` differs from the currently checked out local files. The deployed version includes:

- a chat demo section near the top of the page
- a proof section with a portfolio table on the left and insight cards in a parallel right column
- a typing indicator rendered as a normal chat row inside the message flow

That structure creates two user-facing issues:

1. The chat demo visibly resizes and jumps as the typing row is added and removed.
2. The proof section asks the visitor to process a dense table and dense interpretation in parallel, which weakens the page's reading order.

## Approved Direction

Use a stacked proof flow:

- proof section first
- full-width portfolio table first within that section
- insight cards below the table instead of in a side column
- chat demo moved below the proof section as supporting evidence and experience
- no collapsible or interactive table behavior in this iteration

## Information Architecture

### Section order

1. Hero
2. Proof section
3. Chat/demo section
4. Enterprise / footer CTA

### Proof section structure

The proof section becomes a single narrative block with a vertical reading path:

1. Intro copy
2. Full-width table card
3. Three summary cards beneath the table

This sequence matches the intended user story:

- what is owned
- what Vanna understands
- how that understanding becomes judgment

### Chat/demo structure

The chat section remains visually strong, but it becomes a separate section below the proof block. Its job is to demonstrate reasoning, not to compete with the proof artifact for attention.

Recommended section framing:

- label: `How Vanna Gets There`
- heading: something that emphasizes reasoning, not just messaging

## Layout Changes

### Proof block

Replace the current two-column proof grid with:

- a top table panel spanning full width
- a bottom three-card grid

Desktop:

- one large table card
- three cards in a row below, each with consistent height and spacing

Tablet/mobile:

- table remains first
- cards stack naturally into one column or two columns depending on viewport

### Table cleanup

Keep the real table structure, but reduce cognitive load:

- tighten vertical spacing
- slightly increase emphasis on the holding name
- shorten body copy where needed
- preserve the responsive mobile row transformation already present in CSS
- avoid adding new interaction for this pass

## Typing Stability Fix

### Root cause

The typing indicator is currently mounted as a normal message row inside the scrollable chat body. The chat body uses `min-height` and `max-height` rather than a fixed height. As the typing row appears and disappears, the content height changes and the shell visibly resizes until it reaches its max height.

### Fix

Stabilize the demo shell by:

- giving the chat body a fixed height rather than a flexible min/max range
- reserving stable bottom space for the typing state
- rendering the typing state outside normal message flow, anchored to the bottom of the message viewport

This preserves the illusion of a live response without changing the shell height during the sequence.

## Styling Direction

Preserve the current brand language:

- warm neutral background
- dark green typography
- serif-led headings
- soft bordered surfaces

But improve scanability:

- more whitespace between proof layers
- clearer visual separation between table and interpretation
- less side-by-side density
- chat section slightly more secondary than the proof block

## Implementation Notes

Files expected to change on the deployed branch:

- `src/App.tsx`
- `src/index.css`

No product logic or backend behavior needs to change. This is a frontend composition and styling pass.

## Verification

Verify:

- chat shell height does not jump when typing appears
- proof section renders before the chat section
- proof cards sit below the table, not beside it
- mobile layout keeps the table readable and stacks cards cleanly
