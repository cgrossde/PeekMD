# Mermaid Diagram Rendering

## Overview

PeekMD renders Mermaid diagrams directly in the client from fenced code blocks. Any ` ```mermaid ` block in a Markdown document is detected after rendering and replaced with an SVG diagram inline in the preview.

The Mermaid library is loaded lazily — it is only imported when at least one Mermaid fence is present in the current document. If the document has no Mermaid blocks, the bundle is never loaded.

---

## Hydration trigger

`hydrateMermaid(container, theme)` is defined in `src/lib/mermaid.ts` and called from `App.tsx`.

```ts
// Hydrate Mermaid diagrams whenever the active doc or theme changes.
useLayoutEffect(() => {
  const c = docViewRef.current;
  if (!c || !activeDoc) return;
  const theme = resolveTheme(themeOverride);
  void hydrateMermaid(c, theme);
}, [activeDoc?.path, activeDoc?.html, themeOverride]);
```

The effect fires:

- On initial open of a document (`activeDoc.path` changes).
- After every live-reload re-render of the active document (`activeDoc.html` changes).
- When the theme override changes (`themeOverride` changes), so diagrams are re-rendered to match the current theme.

`useLayoutEffect` runs after React commits DOM mutations but before the browser paints, so the SVG replacement happens in the same frame as the HTML update.

`hydrateMermaid` receives the `docViewRef` container element and the resolved theme string (`'light'` or `'dark'`). It queries that container for `pre > code.language-mermaid` elements — the shape produced by comrak for fenced code blocks with the `mermaid` language tag.

---

## Lazy loading

```ts
let mermaidPromise: Promise<MermaidInstance> | null = null;

async function loadMermaid(): Promise<MermaidInstance> {
  if (!mermaidPromise) {
    mermaidPromise = import('../vendor/mermaid.tiny.min.js').then((m) => {
      const mod = m as unknown as { default?: MermaidInstance } & MermaidInstance;
      return mod.default ?? mod;
    });
  }
  return mermaidPromise;
}
```

`loadMermaid` is called only after at least one fence is found. The result is cached in the module-level `mermaidPromise` variable, so the dynamic import runs at most once per application session regardless of how many documents are opened or how many times the theme changes.

The module is resolved from `src/vendor/mermaid.tiny.min.js` — a local file, never a CDN URL.

---

## Rendering

For each `pre > code.language-mermaid` element found in the container:

1. The `textContent` of the `<code>` element is extracted as the diagram source.
2. A stable DOM id is generated: `peekmd-mermaid-0`, `peekmd-mermaid-1`, etc. (index within the current hydration pass).
3. `mermaid.render(id, text)` is called; it returns `{ svg: string }`.
4. A `<div class="peekmd-mermaid">` is created, its `innerHTML` set to the returned SVG string, and the original `<pre>` is replaced with this wrapper using `pre.replaceWith(wrapper)`.

On error:

- A `<div class="peekmd-mermaid-error">` is created instead.
- Its `textContent` is set to `Mermaid render error: <message>`, where `<message>` comes from `err.message` for `Error` instances or `String(err)` otherwise.
- The original `<pre>` is replaced with the error div.

Fences are processed sequentially (one `await` per fence) to keep render IDs stable and to avoid concurrent mutations on the same container.

---

## Theme

Before processing any fences, `mermaid.initialize` is called with the resolved theme:

```ts
mermaid.initialize({
  startOnLoad: false,
  theme: theme === 'dark' ? 'dark' : 'default',
  securityLevel: 'strict',
});
```

| PeekMD theme | Mermaid theme |
|---|---|
| `'dark'` | `'dark'` |
| `'light'` | `'default'` |

`startOnLoad: false` prevents Mermaid from scanning the entire document on its own. `securityLevel: 'strict'` sandboxes the rendered SVG.

Because `hydrateMermaid` is re-run on `themeOverride` changes (see [Hydration trigger](#hydration-trigger)), switching between light and dark mode re-renders all diagrams with the correct theme.

---

## Vendored bundle

**Path:** `src/vendor/mermaid.tiny.min.js`

This is a trimmed Mermaid build bundled with the application. It intentionally omits:

- Mindmap diagrams
- Architecture diagrams
- KaTeX math rendering

The bundle is never fetched from a CDN; `check-offline` build verification enforces this. The TypeScript type shim lives alongside it at `src/vendor/mermaid.d.ts`:

```ts
declare module '*mermaid.tiny.min.js' {
  interface Mermaid {
    initialize(config: MermaidConfig): void;
    render(id: string, text: string): Promise<RenderResult>;
  }
  const mermaid: Mermaid;
  export default mermaid;
}
```
