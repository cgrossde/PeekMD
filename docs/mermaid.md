# Mermaid Diagram Rendering

## Overview

PeekMD renders Mermaid diagrams directly in the client from fenced code blocks. Any ` ```mermaid ` block in a Markdown document is detected after rendering and replaced with an SVG diagram inline in the preview.

The Mermaid library is loaded lazily — it is only imported when at least one Mermaid fence is present in the current document. If the document has no Mermaid blocks, the bundle is never loaded.

---

## Hydration trigger

`hydrateMermaid(container, theme)` is defined in `src/lib/mermaid.ts` and called from `App.tsx`.

```ts
// Hydrate Mermaid after WebKit has laid out the refreshed document.
useEffect(() => {
  const c = docViewRef.current;
  if (!c || !activeDoc) return;
  const timer = window.setTimeout(() => {
    void hydrateMermaid(c, resolveTheme(themeOverride));
  }, 250);
  return () => window.clearTimeout(timer);
}, [activeDoc, themeOverride]);
```

The effect fires:

- On initial open of a document (`activeDoc.path` changes).
- After every live-reload re-render of the active document (`activeDoc.html` changes).
- When the theme override changes (`themeOverride` changes), so diagrams are re-rendered to match the current theme.

Hydration runs in a normal `useEffect` and is deferred by 250 ms after the document/theme update. Mermaid measures SVG text during layout; this delay lets macOS WKWebView settle the document and fonts before the flowchart renderer runs.

`hydrateMermaid` receives the `docViewRef` container element and the resolved theme string (`'light'` or `'dark'`). It queries that container for `pre > code.language-mermaid` elements — the shape produced by comrak for fenced code blocks with the `mermaid` language tag.

---

## Lazy loading

```ts
let mermaidPromise: Promise<MermaidInstance> | null = null;

async function loadMermaid(): Promise<MermaidInstance> {
  const alreadyLoaded = window.mermaid;
  if (alreadyLoaded) return alreadyLoaded;
  if (!mermaidPromise) {
    mermaidPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = mermaidScriptUrl;
      const timeout = window.setTimeout(
        () => reject(new Error('Mermaid loaded without exposing its API')),
        10_000,
      );
      const checkLoaded = () => {
        if (window.mermaid) {
          window.clearTimeout(timeout);
          resolve(window.mermaid);
        } else {
          window.setTimeout(checkLoaded, 50);
        }
      };
      script.onload = checkLoaded;
      script.onerror = () => reject(new Error('Failed to load Mermaid'));
      document.head.append(script);
    }).catch((err) => {
      mermaidPromise = null;
      throw err;
    });
  }
  return mermaidPromise;
}
```
The example is pseudocode; the implementation also clears its polling timer on success or failure and resets the cached promise after a failed load so a later hydration can retry.

`loadMermaid` is called only after at least one fence is found. The load promise is cached in the module-level `mermaidPromise` variable, so the vendored script is appended at most once per application session regardless of how many documents are opened or how many times the theme changes.

The bundle is loaded from `src/vendor/mermaid.tiny.min.js` as a classic script. This is intentional: the downloaded Mermaid tiny bundle exposes its API through `globalThis.mermaid` rather than using ES module exports. It is a local asset, never a CDN URL.

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

## Controls

Each rendered diagram has a compact control strip with **Zoom out**, **Zoom in**, **Reset zoom**, **Open diagram**, and **Export SVG** buttons. Drag inside the diagram to pan after zooming. Open displays the SVG in a separate window; Export downloads `peekmd-mermaid.svg`. The controls are keyboard-focusable and expose accessible labels; Mermaid links and click actions remain disabled by the strict security mode.

---

## Theme

Before processing any fences, `mermaid.initialize` is called with the resolved theme:

```ts
mermaid.initialize({
  startOnLoad: false,
  theme: theme === 'dark' ? 'dark' : 'default',
  securityLevel: 'strict',
  flowchart: { htmlLabels: false },
});
```

| PeekMD theme | Mermaid theme |
|---|---|
| `'dark'` | `'dark'` |
| `'light'` | `'default'` |

`startOnLoad: false` prevents Mermaid from scanning the entire document on its own. `securityLevel: 'strict'` encodes HTML labels, and `flowchart.htmlLabels: false` avoids SVG `foreignObject` layout, which can hang in macOS WKWebView.

Because `hydrateMermaid` is re-run on `themeOverride` changes (see [Hydration trigger](#hydration-trigger)), switching between light and dark mode re-renders all diagrams with the correct theme.

---

## Vendored bundle

**Path:** `src/vendor/mermaid.tiny.min.js`

This is a trimmed Mermaid build bundled with the application. It intentionally omits:

- Mindmap diagrams
- Architecture diagrams
- KaTeX math rendering

The bundle is never fetched from a CDN; `check-offline` build verification enforces this. It is loaded as a classic script because this vendored build exposes its API through `globalThis.mermaid`.
