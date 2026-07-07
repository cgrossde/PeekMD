/**
 * Lazy mermaid diagram hydration.
 *
 * Finds <pre><code class="language-mermaid"> blocks in a rendered doc and
 * replaces them with rendered SVGs. The mermaid module is loaded on-demand
 * from the vendored bundle — only when a mermaid fence is actually present.
 */

interface MermaidInstance {
  initialize(config: { startOnLoad?: boolean; theme?: string; securityLevel?: string; [k: string]: unknown }): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

// Cached import promise — mermaid loads once for the lifetime of the app.
let mermaidPromise: Promise<MermaidInstance> | null = null;

async function loadMermaid(): Promise<MermaidInstance> {
  if (!mermaidPromise) {
    mermaidPromise = import(/* @vite-ignore */ '../vendor/mermaid.tiny.min.js').then((m) => {
      const mod = m as unknown as { default?: MermaidInstance } & MermaidInstance;
      return mod.default ?? mod;
    });
  }
  return mermaidPromise;
}

export async function hydrateMermaid(
  container: HTMLElement,
  theme: 'light' | 'dark',
): Promise<void> {
  const fences = Array.from(
    container.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
  );
  if (fences.length === 0) return;

  const mermaid = await loadMermaid();

  mermaid.initialize({
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
    securityLevel: 'strict',
  });

  for (let i = 0; i < fences.length; i++) {
    const code = fences[i];
    const pre = code.parentElement;
    if (!pre) continue;

    const text = code.textContent ?? '';
    const id = `peekmd-mermaid-${i}`;

    try {
      const { svg } = await mermaid.render(id, text);
      const wrapper = document.createElement('div');
      wrapper.className = 'peekmd-mermaid';
      wrapper.innerHTML = svg;
      pre.replaceWith(wrapper);
    } catch (err) {
      const errDiv = document.createElement('div');
      errDiv.className = 'peekmd-mermaid-error';
      errDiv.textContent = `Mermaid render error: ${err instanceof Error ? err.message : String(err)}`;
      pre.replaceWith(errDiv);
    }
  }
}
