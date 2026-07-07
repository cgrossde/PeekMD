# Find in Document

## Overview

Press `⌘F` to open the find bar overlay at the bottom of the preview. As you type, all matching substrings in the rendered document are highlighted. Press `Escape` to close the find bar; closing clears all highlights and resets the match state.

The find bar is implemented in `src/components/FindBar.tsx`. Its open/closed state lives in the Zustand store as `ui.findOpen` and is toggled via the `setFind` action.

---

## Search algorithm

`doSearch` runs on every keystroke. It:

1. Calls `clearHighlights` to remove any marks from the previous search.
2. Returns early (clearing state) if the query is empty.
3. Walks the `.markdown-body` article element recursively. For each `TEXT_NODE`, it lowercases both the node text and the query, then finds all non-overlapping substring matches with `String.prototype.indexOf` in a loop. Each match is captured as a `Range`.
4. Skips `MARK` elements during traversal so it never double-wraps an existing highlight.
5. Wraps each `Range` in a `<mark class="peekmd-find-hit">` element. Wrapping is applied **last-to-first** so earlier DOM offsets are not invalidated by inserting nodes before them. The first match additionally receives the class `is-current`.
6. Stores the collected ranges in state and scrolls to the first match.

The match count is displayed as `current / total` (e.g. `2 / 7`). When there are no matches and the query is non-empty, the display shows `0 / 0`.

---

## Navigation

| Action | Behavior |
|---|---|
| `Enter` | Advance to the next match (wraps around). |
| `Shift+Enter` | Go to the previous match (wraps around). |
| Next button (↓) | Same as `Enter`. |
| Prev button (↑) | Same as `Shift+Enter`. |

`scrollToCurrent` manages the active match: it toggles the `is-current` class to the target index across all `.peekmd-find-hit` marks and calls `scrollIntoView({ block: 'center', behavior: 'smooth' })` on the newly current mark.

---

## Highlight cleanup

`clearHighlights(root)` removes every `<mark class="peekmd-find-hit">` inside `root` by unwrapping — it moves each mark's children into the mark's parent, then removes the now-empty mark element. After each unwrap it calls `parent.normalize()` to merge adjacent text nodes back into a single node.

This approach intentionally avoids snapshotting or restoring `innerHTML`. An earlier implementation saved `article.innerHTML` on open and reverted to it on close or each keystroke. That strategy silently discarded any live-reload re-render that happened while Find was open: the store would have moved to fresh HTML, but the visible DOM was reverted to the stale pre-Find snapshot. By only ever removing the marks it created, `clearHighlights` is safe to call at any time without affecting any other DOM mutations.

---

## Live-reload interaction

`FindBar` subscribes to `activeHtml` — the rendered HTML of the currently active document — from the store:

```ts
const activeHtml = useStore(s =>
  s.openDocs.find(d => d.path === s.activeDocId)?.html
);
```

A `useEffect` keyed on `activeHtml` re-runs `doSearch(query)` whenever the value changes, but only when the find bar is open. This means that if the file is saved and the document re-renders while Find is open, highlights are cleared and rebuilt against the new DOM automatically — the match list stays aligned with what is actually on screen.

---

## Keyboard guard

`src/lib/keybindings.ts` registers a global `keydown` handler for application-wide shortcuts (open file, navigate, toggle sidebar, etc.). That handler returns early when either the command palette or the find bar is open:

```ts
if (st.ui.paletteOpen || st.ui.findOpen) return;
```

This prevents global shortcuts from firing while the user is typing a search query. The find bar manages its own `⌘F` and `Escape` bindings through a separate `useEffect`-registered listener inside `FindBar`.
