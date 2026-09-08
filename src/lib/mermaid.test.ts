import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn().mockResolvedValue(undefined);
const save = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save }));

const { hydrateMermaid } = await import('./mermaid');

describe('hydrateMermaid', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as Window & { mermaid?: unknown }).mermaid;
    document.head.querySelector('script[data-peekmd-mermaid]')?.remove();
  });

  it('loads the vendored bundle as a classic script and replaces the fence', async () => {
    const mermaid = {
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' }),
    };
    const append = vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
      const script = nodes[0] as HTMLScriptElement;
      (window as Window & { mermaid?: unknown }).mermaid = mermaid;
      script.onload?.(new Event('load'));
    });
    const container = document.createElement('div');
    container.innerHTML = '<pre><code class="language-mermaid">flowchart TD\nA --> B</code></pre>';

    await Promise.all([
      hydrateMermaid(container, 'light'),
      hydrateMermaid(container, 'light'),
    ]);

    expect(append).toHaveBeenCalledOnce();
    expect(mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'strict',
      flowchart: { htmlLabels: false },
    });
    expect(mermaid.render).toHaveBeenCalledWith('peekmd-mermaid-0', 'flowchart TD\nA --> B');
    const renderedSvg = container.querySelector<SVGElement>('.peekmd-mermaid svg');
    expect(renderedSvg?.style.transform).toContain('scale(1)');
    expect(container.querySelector('.peekmd-mermaid-controls')).not.toBeNull();
    expect(container.querySelectorAll('.peekmd-mermaid-control').length).toBe(5);
    container.querySelector<HTMLButtonElement>('[aria-label="Open diagram"]')?.click();
    expect(invoke).toHaveBeenCalledWith('open_svg', expect.objectContaining({ svg: expect.stringContaining('<svg') }));

    let releaseFirstRefresh!: (result: { svg: string }) => void;
    mermaid.render.mockImplementationOnce(
      () => new Promise(resolve => { releaseFirstRefresh = resolve; }),
    );
    container.innerHTML = '<pre><code class="language-mermaid">flowchart TD\nA --> B</code></pre>';
    const firstRefresh = hydrateMermaid(container, 'light');
    await Promise.resolve();

    container.innerHTML = '<pre><code class="language-mermaid">flowchart TD\nA --> C</code></pre>';
    const secondRefresh = hydrateMermaid(container, 'light');
    await secondRefresh;
    releaseFirstRefresh({ svg: '<svg data-testid="stale-diagram"></svg>' });
    await firstRefresh;

    expect(mermaid.render).toHaveBeenCalledTimes(3);
    expect(container.querySelector('.peekmd-mermaid svg')?.getAttribute('data-testid')).toBe('diagram');
  });
});
