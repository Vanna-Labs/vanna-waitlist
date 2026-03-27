# Proof-First Landing Reflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the deployed landing page so the proof section leads, the chat demo follows as supporting evidence, and the typing indicator no longer changes the visible shell height.

**Architecture:** Keep the existing single-page React structure on the deployed branch, but reorder the proof and demo sections in `src/App.tsx`, change the proof layout from a split grid to a stacked proof card plus summary cards, and adjust the chat container so the typing state is visually anchored without changing layout height.

**Tech Stack:** React, TypeScript, Vite, CSS

---

## File Structure

- Modify: `src/App.tsx`
  - Reorder the proof and chat sections.
  - Keep the existing content model, but reshape the proof markup into a stacked table-plus-cards layout.
  - Update the chat shell markup so the typing indicator can live in a stable bottom slot rather than the scrolling message flow.
- Modify: `src/index.css`
  - Update proof-section layout styles.
  - Update chat shell sizing and typing-indicator positioning styles.
  - Preserve the existing responsive table treatment and adapt cards for the new layout.
- Reference: `docs/superpowers/specs/2026-03-27-proof-chat-reflow-design.md`

### Task 1: Establish the failing behavior target

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Inspect the deployed branch source**

Run: `git show origin/main:src/App.tsx | sed -n '1,260p'`
Expected: proof section appears after the chat section and typing is rendered as a normal chat row

- [ ] **Step 2: Inspect the deployed branch styles**

Run: `git show origin/main:src/index.css | sed -n '200,760p'`
Expected: chat body uses min/max height and proof layout uses a two-column grid

### Task 2: Rebuild the page narrative order

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing test**

Test type: manual structural verification in browser
Failure condition: proof content still appears after the chat/demo section

- [ ] **Step 2: Implement minimal section reorder**

Move the proof section above the chat/demo section while preserving existing content and CTA wiring.

- [ ] **Step 3: Verify the reordered structure**

Run: `npm run build`
Expected: build passes and rendered page source reflects proof-first ordering

### Task 3: Convert proof section to a stacked layout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write the failing test**

Test type: manual browser verification
Failure condition: table and insights still render in parallel columns on desktop

- [ ] **Step 2: Update proof markup**

Reshape the proof grid so it becomes:

- top table panel
- bottom card grid with current pattern, principles, and meaning blocks

- [ ] **Step 3: Update proof styling**

Replace the two-column shell with stacked proof styles and adjust spacing, panel borders, and card grid behavior.

- [ ] **Step 4: Verify the proof layout**

Run: `npm run build`
Expected: build passes with no CSS or JSX errors

### Task 4: Stabilize the typing indicator

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write the failing test**

Test type: manual browser verification
Failure condition: chat shell height changes when typing appears or disappears

- [ ] **Step 2: Move typing into a stable slot**

Keep message rendering in the scrollable body, but render the typing indicator in a dedicated anchored area that does not change the shell height.

- [ ] **Step 3: Lock chat viewport height**

Use a fixed chat viewport height and reserve internal bottom spacing so the typing state does not overlap message content.

- [ ] **Step 4: Verify the chat behavior**

Run: `npm run build`
Expected: build passes and the browser demo no longer jumps during typing transitions

### Task 5: Responsive cleanup and verification

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Adjust responsive proof cards**

Ensure the bottom cards collapse cleanly for tablet and mobile without breaking the mobile table formatting.

- [ ] **Step 2: Run full verification**

Run: `npm run build`
Expected: Vite production build succeeds with exit code 0

- [ ] **Step 3: Manual browser verification**

Verify:

- proof section is above chat/demo
- table appears before summary cards
- cards sit below the table on desktop
- cards stack cleanly on small screens
- typing no longer changes shell height

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/index.css docs/superpowers/specs/2026-03-27-proof-chat-reflow-design.md docs/superpowers/plans/2026-03-27-proof-chat-reflow.md
git commit -m "Refactor landing page to a proof-first flow"
```
