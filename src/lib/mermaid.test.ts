import { afterEach, describe, expect, it, vi } from 'vitest';

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
    expect(container.querySelector('.peekmd-mermaid svg')?.getAttribute('data-testid')).toBe('diagram');
    expect(container.querySelector('pre')).toBeNull();
  });
});
