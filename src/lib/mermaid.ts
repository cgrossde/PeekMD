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
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

type MermaidWindow = Window & { mermaid?: MermaidInstance };

// Cached load promise — mermaid loads once for the lifetime of the app.
let mermaidPromise: Promise<MermaidInstance> | null = null;
type HydrationEntry = { firstFence: HTMLElement; theme: 'light' | 'dark'; promise: Promise<void> };
const hydrationInFlight = new WeakMap<HTMLElement, HydrationEntry>();
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function serializeSvg(svg: SVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

async function openDiagram(svg: SVGElement): Promise<void> {
  await invoke('open_svg', { svg: serializeSvg(svg) });
}

async function exportDiagram(svg: SVGElement): Promise<void> {
  const path = await save({
    defaultPath: 'peekmd-mermaid.svg',
    filters: [{ name: 'SVG image', extensions: ['svg'] }],
  });
  if (path) await invoke('write_svg', { path, svg: serializeSvg(svg) });
}

async function loadMermaid(): Promise<MermaidInstance> {
  const alreadyLoaded = (window as MermaidWindow).mermaid;
  if (alreadyLoaded) return alreadyLoaded;

  if (!mermaidPromise) {
    mermaidPromise = new Promise<MermaidInstance>((resolve, reject) => {
      const script = document.createElement('script');
      script.dataset.peekmdMermaid = 'true';
      script.src = mermaidScriptUrl;

      let pollId: number | undefined;
      const failId = window.setTimeout(() => {
        if (pollId !== undefined) window.clearTimeout(pollId);
        reject(new Error('Mermaid loaded without exposing its API'));
      }, 10_000);
      const finish = (result: MermaidInstance | Error) => {
        if (pollId !== undefined) window.clearTimeout(pollId);
        window.clearTimeout(failId);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const checkLoaded = () => {
        const mermaid = (window as MermaidWindow).mermaid;
        if (mermaid) {
          finish(mermaid);
          return;
        }
        pollId = window.setTimeout(checkLoaded, 50);
      };

      script.onload = checkLoaded;
      script.onerror = () => finish(new Error('Failed to load Mermaid'));
      document.head.append(script);
    }).catch((err: unknown) => {
      mermaidPromise = null;
      throw err;
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
  fences: HTMLElement[],
): Promise<void> {
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

function createDiagramWrapper(svgMarkup: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'peekmd-mermaid';
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', 'Mermaid diagram');

  const viewport = document.createElement('div');
  viewport.className = 'peekmd-mermaid-viewport';
  viewport.innerHTML = svgMarkup;
  const svg = viewport.querySelector<SVGElement>('svg');
  if (!svg) {
    wrapper.append(viewport);
    return wrapper;
  }

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragStart: { x: number; y: number; offsetX: number; offsetY: number } | null = null;

  const applyTransform = () => {
    svg.style.transformOrigin = 'top left';
    svg.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  };

  const controls = document.createElement('div');
  controls.className = 'peekmd-mermaid-controls';
  const button = (label: string, title: string, onClick: () => void) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'peekmd-mermaid-control';
    control.setAttribute('aria-label', label);
    control.title = title;
    control.textContent = label === 'Zoom in' ? '+' : label === 'Zoom out' ? '−' : label === 'Reset zoom' ? 'Reset' : label === 'Open diagram' ? 'Open' : 'Export';
    control.addEventListener('click', onClick);
    controls.append(control);
  };

  button('Zoom out', 'Zoom out', () => {
    scale = Math.max(0.5, scale - 0.25);
    applyTransform();
  });
  button('Zoom in', 'Zoom in', () => {
    scale = Math.min(3, scale + 0.25);
    applyTransform();
  });
  button('Reset zoom', 'Reset zoom', () => {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    applyTransform();
  });
  button('Open diagram', 'Open diagram in a new window', () => openDiagram(svg));
  button('Export SVG', 'Export diagram as SVG', () => exportDiagram(svg));

  viewport.addEventListener('pointerdown', (event) => {
    dragStart = { x: event.clientX, y: event.clientY, offsetX, offsetY };
    viewport.classList.add('is-dragging');
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!dragStart) return;
    offsetX = dragStart.offsetX + event.clientX - dragStart.x;
    offsetY = dragStart.offsetY + event.clientY - dragStart.y;
    applyTransform();
  });
  const stopDragging = (event: PointerEvent) => {
    if (!dragStart) return;
    dragStart = null;
    viewport.classList.remove('is-dragging');
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  };
  viewport.addEventListener('pointerup', stopDragging);
  viewport.addEventListener('pointercancel', stopDragging);
  applyTransform();

  wrapper.append(viewport, controls);
  return wrapper;
}

  for (let i = 0; i < fences.length; i++) {
    const code = fences[i];
    const pre = code.parentElement;
    if (!pre) continue;

    const text = code.textContent ?? '';
    const id = `peekmd-mermaid-${i}`;

    try {
      const { svg } = await mermaid.render(id, text);
      const wrapper = createDiagramWrapper(svg);
      pre.replaceWith(wrapper);
    } catch (err) {
      replaceWithError(pre, err);
    }
  }
}
export function hydrateMermaid(container: HTMLElement, theme: 'light' | 'dark'): Promise<void> {
  const fences = Array.from(
    container.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
  );
  if (fences.length === 0) return Promise.resolve();

  const existing = hydrationInFlight.get(container);
  if (existing?.firstFence === fences[0] && existing.theme === theme) {
    return existing.promise;
  }

  const promise = hydrateMermaidOnce(container, theme, fences).finally(() => {
    if (hydrationInFlight.get(container)?.promise === promise) {
      hydrationInFlight.delete(container);
    }
  });
  hydrationInFlight.set(container, { firstFence: fences[0], theme, promise });
  return promise;
}
