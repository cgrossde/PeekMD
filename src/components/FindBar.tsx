import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

/**
 * Removes every <mark class="peekmd-find-hit"> under `root`, unwrapping its
 * contents back into the surrounding text and merging adjacent text nodes.
 *
 * This intentionally never touches anything else in the tree. The previous
 * implementation snapshotted `article.innerHTML` on open and reverted to
 * that snapshot on close / on every keystroke — which silently discarded any
 * live-reload re-render that happened while Find was open (the store had
 * already moved on to fresh HTML, but the visible DOM got reverted to the
 * stale pre-Find snapshot). Only ever removing the marks we created avoids
 * that class of bug entirely, regardless of what else changed the DOM.
 */
function clearHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll<HTMLElement>('.peekmd-find-hit');
  marks.forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

export function FindBar() {
  const findOpen = useStore(s => s.ui.findOpen);
  const setFind = useStore(s => s.setFind);
  // Re-run the search whenever the active doc's rendered HTML changes (e.g. a
  // live-reload while Find is open) so highlights stay aligned with what's
  // actually on screen instead of going stale.
  const activeHtml = useStore(s => s.openDocs.find(d => d.path === s.activeDocId)?.html);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Range[]>([]);
  const [current, setCurrent] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘F binding
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFind(true);
      }
      if (e.key === 'Escape' && findOpen) {
        e.preventDefault();
        setFind(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [findOpen, setFind]);

  useEffect(() => {
    if (findOpen) {
      setQuery('');
      setHits([]);
      setCurrent(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      const article = document.querySelector<HTMLElement>('.markdown-body');
      if (article) clearHighlights(article);
      setHits([]);
      setQuery('');
    }
  }, [findOpen]);

  // Keep highlights aligned with the live document (see clearHighlights doc).
  useEffect(() => {
    if (!findOpen) return;
    doSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHtml]);

  const doSearch = (q: string) => {
    const article = document.querySelector<HTMLElement>('.markdown-body');
    if (!article) return;

    clearHighlights(article);

    if (!q) { setHits([]); setCurrent(0); return; }

    const newHits: Range[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? '';
        const lower = text.toLowerCase();
        const ql = q.toLowerCase();
        let idx = lower.indexOf(ql);
        while (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + ql.length);
          newHits.push(range);
          idx = lower.indexOf(ql, idx + 1);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName !== 'MARK') {
        Array.from(node.childNodes).forEach(walk);
      }
    };
    walk(article);

    // Wrap hits in <mark> from last to first (to preserve range offsets)
    for (let i = newHits.length - 1; i >= 0; i--) {
      const mark = document.createElement('mark');
      mark.className = 'peekmd-find-hit' + (i === 0 ? ' is-current' : '');
      try { newHits[i].surroundContents(mark); } catch { /* skip complex ranges */ }
    }

    setHits(newHits);
    setCurrent(0);
    scrollToCurrent(0);
  };

  const scrollToCurrent = (idx: number) => {
    const marks = document.querySelectorAll<HTMLElement>('.peekmd-find-hit');
    marks.forEach((m, i) => {
      m.classList.toggle('is-current', i === idx);
    });
    marks[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const next = () => {
    if (hits.length === 0) return;
    const n = (current + 1) % hits.length;
    setCurrent(n);
    scrollToCurrent(n);
  };

  const prev = () => {
    if (hits.length === 0) return;
    const n = (current - 1 + hits.length) % hits.length;
    setCurrent(n);
    scrollToCurrent(n);
  };

  if (!findOpen) return null;

  return (
    <div className="peekmd-findbar">
      <input
        ref={inputRef}
        className="peekmd-findbar-input"
        type="text"
        aria-label="Find in document"
        placeholder="Find in document…"
        value={query}
        onChange={e => { setQuery(e.target.value); doSearch(e.target.value); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) prev(); else next(); }
          if (e.key === 'Escape') { e.preventDefault(); setFind(false); }
        }}
      />
      <span className="peekmd-findbar-count">
        {hits.length > 0 ? `${current + 1} / ${hits.length}` : query ? '0 / 0' : ''}
      </span>
      <button type="button" className="peekmd-findbar-btn" aria-label="Previous match" onClick={prev} title="Previous (⇧Enter)">↑</button>
      <button type="button" className="peekmd-findbar-btn" aria-label="Next match" onClick={next} title="Next (Enter)">↓</button>
      <button type="button" className="peekmd-findbar-close" onClick={() => setFind(false)} aria-label="Close find bar">×</button>
    </div>
  );
}
