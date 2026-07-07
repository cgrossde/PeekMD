# Table of Contents

PeekMD renders a right-rail Table of Contents panel that auto-generates navigation links from the H2 and H3 headings in the active document.

## Overview

The TOC is a fixed sidebar panel rendered to the right of the document area. It is driven by the `headings` array on the active `Doc` object in the store, which is populated by the Rust renderer (`render.rs`) when the file is opened or refreshed.

The store holds a single boolean flag that controls user intent:

```ts
// src/store.ts
ui: {
  tocVisible: boolean;
  // ...
}
```

`setToc(visible: boolean)` is the only action that mutates this flag. The panel itself applies additional runtime conditions on top of `tocVisible` before deciding whether to render.

The `Heading` type:

```ts
export type Heading = { id: string; level: number; text: string };
```

`id` corresponds to the `#peekmd-<slug>` anchor rendered on each heading element in the document HTML.

## Heading levels

The Rust renderer extracts H1, H2, and H3 headings from the document and stores them all in `doc.headings`. The TOC component filters this list to H2 and H3 only before rendering:

```ts
const visible = headings.filter(h => h.level === 2 || h.level === 3);
```

H1 headings are never shown in the TOC panel or the TocChip count. If no H2 or H3 headings exist in the document, `visible.length === 0` and the TOC is suppressed entirely.

## Auto-hide conditions

The panel hides (returns `null`) when any of the following is true:

| Condition | Details |
|---|---|
| `!tocVisible` | The user has not enabled the TOC, or has closed it. |
| `width < 1200` | The window is narrower than 1200 CSS pixels. |
| `visible.length === 0` | No H2 or H3 headings in the active document. |

The `useWindowWidth` hook measures current window width, preferring `window.visualViewport.width` and falling back to `window.innerWidth`. It subscribes to both `visualViewport` resize and `window` resize events via a `useEffect`, so the value stays current as the user resizes the window.

```ts
function useWindowWidth() {
  const [width, setWidth] = useState(() => window.visualViewport?.width ?? window.innerWidth);
  useEffect(() => {
    const vp = window.visualViewport;
    const update = () => setWidth(vp?.width ?? window.innerWidth);
    vp?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      vp?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return width;
}
```

## TocChip

When the TOC rail is not visible but the document has H2/H3 headings, a compact `☰ TOC` button (`TocChip`) appears in the TopBar. Its visibility rule is the inverse of the rail:

```ts
if (visible.length === 0) return null;
if (tocVisible && width >= 1200) return null; // rail is already showing
```

Clicking `TocChip`:
1. Calls `widenToShowToc()`, which reads the current physical window size via Tauri's `getCurrentWindow().innerSize()`, computes a target of `1200 * devicePixelRatio` physical pixels, and calls `setSize` only if the window is currently narrower.
2. Calls `setToc(true)` to set `ui.tocVisible = true`.

This guarantees the rail will be wide enough to render after the click, even when the user's window is narrow.

```ts
async function widenToShowToc() {
  const win = getCurrentWindow();
  const size = await win.innerSize();
  const targetPx = Math.round(1200 * window.devicePixelRatio);
  if (size.width < targetPx) {
    await win.setSize(new PhysicalSize(targetPx, size.height));
  }
}
```

## Scrollspy

An `IntersectionObserver` tracks which heading is currently at the top of the viewport and sets `activeId` to its element id. The active heading's TOC link receives the `is-active` CSS class.

The observer is configured with `rootMargin: '0px 0px -80% 0px'`, which means a heading is considered "intersecting" only when it is within the top 20% of the viewport. When a heading enters that zone, `activeId` is updated to that heading's id.

The observer is set up (and torn down) whenever `tocVisible` or the list of heading ids changes:

```ts
useEffect(() => {
  if (!tocVisible || visible.length === 0) return;
  const targets = visible
    .map(h => document.getElementById(h.id))
    .filter((el): el is HTMLElement => el !== null);
  if (targets.length === 0) return;
  const obs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setActiveId(e.target.id); break; }
      }
    },
    { threshold: [0], rootMargin: '0px 0px -80% 0px' },
  );
  targets.forEach(t => obs.observe(t));
  return () => obs.disconnect();
}, [tocVisible, visible.map(h => h.id).join(',')]);
```

Heading elements are looked up by `h.id` directly (e.g. `document.getElementById('peekmd-my-heading')`).

Clicking a TOC link scrolls the document using `scrollTo` on `.peekmd-doc-area` with `behavior: 'smooth'`, and immediately sets `activeId` to that heading's id without waiting for the observer.

## Keyboard shortcut: Command+Shift+T

`⌘⇧T` toggles the TOC. The handler is registered inside a `useEffect` in `TOC.tsx` — it is **not** listed in `keybindings.ts`.

```ts
useEffect(() => {
  const handler = async (e: KeyboardEvent) => {
    if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      const opening = !tocVisible;
      if (opening) await widenToShowToc();
      setToc(opening);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [tocVisible, setToc]);
```

When opening (`!tocVisible` before the toggle), `widenToShowToc()` is called first so the window is guaranteed to be at least 1200 physical pixels wide when the rail renders. When closing, the window size is left unchanged.

## Closing the TOC

The TOC header renders a close button (`×`) that calls `setToc(false)`. This sets `ui.tocVisible = false` in the store. The window is not resized on close.

## CSS classes

| Class | Element |
|---|---|
| `peekmd-toc` | The `<nav>` wrapper |
| `peekmd-toc-header` | Header row with title and close button |
| `peekmd-toc-close` | The `×` close button |
| `peekmd-toc-list` | The `<ul>` of links |
| `peekmd-toc-item` | Each `<li>` |
| `peekmd-toc-h2` | Applied to H2-level items |
| `peekmd-toc-h3` | Applied to H3-level items |
| `is-active` | Added to the item matching `activeId` |
| `peekmd-toc-link` | Each `<a>` anchor |
| `peekmd-toc-chip` | The TopBar `☰ TOC` button |
