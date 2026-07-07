import { useEffect, useState } from 'react';
import { getCurrentWindow, PhysicalSize } from '@tauri-apps/api/window';
import { useStore } from '../store';

function useWindowWidth() {
  const [width, setWidth] = useState(() => window.visualViewport?.width ?? window.innerWidth);
  useEffect(() => {
    const vp = window.visualViewport;
    const update = () => setWidth(vp?.width ?? window.innerWidth);
    vp?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => { vp?.removeEventListener('resize', update); window.removeEventListener('resize', update); };
  }, []);
  return width;
}

async function widenToShowToc() {
  const win = getCurrentWindow();
  const size = await win.innerSize();
  const targetPx = Math.round(1200 * window.devicePixelRatio);
  if (size.width < targetPx) {
    await win.setSize(new PhysicalSize(targetPx, size.height));
  }
}

export function TOC() {
  const headings = useStore(s => s.openDocs.find(d => d.path === s.activeDocId)?.headings) ?? [];
  const tocVisible = useStore(s => s.ui.tocVisible);
  const setToc = useStore(s => s.setToc);
  const [activeId, setActiveId] = useState<string | null>(null);
  const width = useWindowWidth();
  const visible = headings.filter(h => h.level === 2 || h.level === 3);

  // ⌘⇧T keybinding
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

  // Scroll spy
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

  // Hidden when: user hasn't toggled it on, window too narrow, or no headings
  if (!tocVisible || width < 1200 || visible.length === 0) return null;

  return (
    <nav className="peekmd-toc" aria-label="Table of contents">
      <div className="peekmd-toc-header">
        <span>Contents</span>
        <button type="button" className="peekmd-toc-close" onClick={() => setToc(false)} aria-label="Close table of contents">×</button>
      </div>
      <ul className="peekmd-toc-list">
        {visible.map(h => (
          <li key={h.id} className={`peekmd-toc-item peekmd-toc-h${h.level}${activeId === h.id ? ' is-active' : ''}`}>
            <a
              href={`#${h.id}`}
              className="peekmd-toc-link"
              onClick={(e) => {
                e.preventDefault();
                const target = document.getElementById(h.id);
                const scroller = document.querySelector<HTMLElement>('.peekmd-doc-area');
                if (target && scroller) {
                  const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16;
                  scroller.scrollTo({ top, behavior: 'smooth' });
                  setActiveId(h.id);
                }
              }}
            >{h.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function TocChip() {
  const headings = useStore(s => s.openDocs.find(d => d.path === s.activeDocId)?.headings) ?? [];
  const tocVisible = useStore(s => s.ui.tocVisible);
  const setToc = useStore(s => s.setToc);
  const width = useWindowWidth();
  const visible = headings.filter(h => h.level === 2 || h.level === 3);
  if (visible.length === 0) return null;
  if (tocVisible && width >= 1200) return null;  // rail is already showing
  return (
    <button
      type="button"
      className="peekmd-toc-chip"
      onClick={async () => {
        await widenToShowToc();
        setToc(true);
      }}
      title="Show table of contents (⌘⇧T)"
    >
      ☰ TOC
    </button>
  );
}
