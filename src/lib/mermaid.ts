/**
 * Lazy mermaid diagram hydration.
 *
 * Finds <pre><code class="language-mermaid"> blocks in a rendered doc and
 * replaces them with rendered SVGs. The vendored Mermaid script is loaded
 * on-demand — only when a mermaid fence is actually present.
 */
interface MermaidInstance {
  initialize(config: { startOnLoad?: boolean; theme?: string; securityLevel?: string; [k: string]: unknown }): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

import mermaidScriptUrl from '../vendor/mermaid.tiny.min.js?url';

type MermaidWindow = Window & { mermaid?: MermaidInstance };

// Cached load promise — mermaid loads once for the lifetime of the app.
let mermaidPromise: Promise<MermaidInstance> | null = null;
let hydrationInFlight: Promise<void> | null = null;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function loadMermaid(): Promise<MermaidInstance> {
  const alreadyLoaded = (window as MermaidWindow).mermaid;
  if (alreadyLoaded) return alreadyLoaded;

  if (!mermaidPromise) {
    mermaidPromise = new Promise<MermaidInstance>((resolve, reject) => {
      const script = document.createElement('script');
      script.dataset.peekmdMermaid = 'true';
      script.src = mermaidScriptUrl;

      let timeoutId: number | undefined;
      const checkLoaded = () => {
        const mermaid = (window as MermaidWindow).mermaid;
        if (mermaid) {
          if (timeoutId !== undefined) window.clearTimeout(timeoutId);
          resolve(mermaid);
          return;
        }
        timeoutId = window.setTimeout(checkLoaded, 50);
      };

      script.onload = checkLoaded;
      script.onerror = () => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        reject(new Error('Failed to load Mermaid'));
      };
      document.head.append(script);
      checkLoaded();
    });
  }
  return mermaidPromise;
}

function replaceWithError(pre: HTMLElement, err: unknown): void {
  const errDiv = document.createElement('div');
  errDiv.className = 'peekmd-mermaid-error';
  errDiv.textContent = `Mermaid render error: ${errorMessage(err)}`;
  pre.replaceWith(errDiv);
}

async function hydrateMermaidOnce(
  container: HTMLElement,
  theme: 'light' | 'dark',
): Promise<void> {
  const fences = Array.from(
    container.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
  );
  if (fences.length === 0) return;

  let mermaid: MermaidInstance;
  try {
    mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'strict',
      flowchart: { htmlLabels: false },
    });
    if (document.fonts) await document.fonts.ready;
  } catch (err) {
    for (const code of fences) {
      const pre = code.parentElement;
      if (pre) replaceWithError(pre, err);
    }
    return;
  }

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
      replaceWithError(pre, err);
    }
  }
}
export function hydrateMermaid(container: HTMLElement, theme: 'light' | 'dark'): Promise<void> {
  if (!hydrationInFlight) {
    hydrationInFlight = hydrateMermaidOnce(container, theme).finally(() => {
      hydrationInFlight = null;
    });
  }
  return hydrationInFlight;
}
