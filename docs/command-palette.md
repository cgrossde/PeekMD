# Command Palette

## Overview

The command palette is a single-input overlay that provides fast access to open documents, recently closed documents, heading anchors in the active document, and named commands.

- **Open**: `⌘K`
- **Close**: `⌘K` again, `Escape`, or click the backdrop

When the palette opens it clears its query field, resets the selection to the first item, and immediately focuses the input. Closing the palette does not affect the document state.

---

## Item Sources

Items are drawn from four sources and concatenated in this order:

### 1. Open documents (`kind: doc`)

One entry per currently open document. Selecting an entry activates that document and closes the palette.

- **Label**: the document title
- **Secondary**: the full file path

### 2. Recently closed documents (`kind: recent`)

One entry per entry in `recentlyClosed` (the store's `RecentEntry[]` list). Selecting an entry reopens the file.

- **Label**: `Reopen: <title or filename stem>`
- **Secondary**: the full file path

### 3. Headings in the active document (`kind: heading`)

Headings at levels H1, H2, and H3 from the active document's `headings` array (levels 4 and deeper are excluded). Only present when a document is active. Selecting an entry sets `location.hash` to the heading's anchor id.

- **Label**: `Jump to: <heading text>`
- **Secondary**: `H1`, `H2`, or `H3`

### 4. Named commands (`kind: cmd`)

Fixed commands, always present (some conditionally on an active document):

| Label | Action |
|---|---|
| Toggle sidebar | Show/hide the sidebar panel |
| Toggle TOC | Show/hide the table of contents panel |
| Toggle theme | Cycle the theme override (calls `toggleTheme`) |
| Print / Save as PDF | Triggers `window.print()` |
| Find in document | Opens the find bar |
| Force re-render | Re-renders the active document from disk |
| Reveal in Finder | Calls the `reveal_in_finder` Tauri command — only shown when a document is active |
| Copy path | Calls the `copy_path` Tauri command — only shown when a document is active |

---

## Fuzzy Search

Search is provided by `score()` in `src/lib/fuzzy.ts`. The query is matched against each item's `label` concatenated with its `secondary` field (space-separated).

### Empty query

All items are shown in their natural order (sources listed above), capped at the first 50.

### Non-empty query

Each item is scored, items with a score of `-Infinity` (no match) are removed, the survivors are sorted by score descending, and the top 50 are shown.

### Scoring algorithm

`score(query, target)` is a case-insensitive subsequence scorer with three tiers:

1. **Substring match** (`target` contains `query` as a contiguous run):
   - Base score: **100**
   - Exact match bonus: **+50** (query equals the full target)
   - Prefix bonus: **+20** (target starts with query)

2. **Subsequence match** (all query characters appear in order in the target, but not necessarily contiguous):
   - Base score: **50**
   - Penalty: subtract the total number of character gaps between consecutive matches
   - First-character-at-zero bonus: **+10** (first matched character is at index 0)

3. **No match** (query characters cannot all be found in order): returns `-Infinity` — the item is excluded from results.

Higher scores float to the top. A direct prefix hit (e.g. typing `"tog"` against `"Toggle sidebar"`) will always rank above a gapped subsequence match.

---

## Keyboard Navigation

All keyboard handling is attached to the palette's `<input>` element via `onKeyDown`:

| Key | Action |
|---|---|
| `ArrowDown` | Move selection down one item (stops at last) |
| `ArrowUp` | Move selection up one item (stops at first) |
| `Enter` | Run the currently selected item |
| `Escape` | Close the palette |

Mouse hover also updates the selected index, and clicking an item runs it directly.

---

## Global Keyboard Guard

While the palette is open, the global keybinding handler in `src/lib/keybindings.ts` returns early before processing any `⌘`-key shortcut:

```ts
if (st.ui.paletteOpen || st.ui.findOpen) return;
```

This prevents background shortcuts (such as `⌘W` closing the active document) from firing underneath the overlay. The palette's own `⌘K` and `Escape` bindings are registered separately — directly on the `window` in the `CommandPalette` component — and are not affected by this guard.
