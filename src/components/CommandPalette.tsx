import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { score } from '../lib/fuzzy';
import { stemName } from '../lib/paths';

type Item = { id: string; label: string; secondary?: string; kind: 'doc' | 'recent' | 'heading' | 'cmd'; run(): void };

export function CommandPalette() {
  const paletteOpen = useStore(s => s.ui.paletteOpen);
  const setPalette = useStore(s => s.setPalette);
  const openDocs = useStore(s => s.openDocs);
  const activeDocId = useStore(s => s.activeDocId);
  const recentlyClosed = useStore(s => s.recentlyClosed);
  const activate = useStore(s => s.activate);
  const reopenRecent = useStore(s => s.reopenRecent);
  const setSidebar = useStore(s => s.setSidebar);
  const setToc = useStore(s => s.setToc);
  const refreshActive = useStore(s => s.refreshActive);
  const toggleTheme = useStore(s => s.toggleTheme);
  const sidebarVisible = useStore(s => s.ui.sidebarVisible);
  const tocVisible = useStore(s => s.ui.tocVisible);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // ⌘K binding
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(!paletteOpen);
      }
      if (e.key === 'Escape' && paletteOpen) {
        e.preventDefault();
        setPalette(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paletteOpen, setPalette]);

  useEffect(() => {
    if (paletteOpen) { setQuery(''); setSelected(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [paletteOpen]);

  const activeDoc = openDocs.find(d => d.path === activeDocId);

  const items: Item[] = [
    ...openDocs.map(d => ({ id: 'doc:' + d.path, label: d.title, secondary: d.path, kind: 'doc' as const, run: () => { activate(d.path); setPalette(false); } })),
    ...recentlyClosed.map(r => ({ id: 'rec:' + r.path, label: 'Reopen: ' + (r.title || stemName(r.path)), secondary: r.path, kind: 'recent' as const, run: () => { void reopenRecent(r.path); setPalette(false); } })),
    ...(activeDoc?.headings.filter(h => h.level <= 3) ?? []).map(h => ({ id: 'h:' + h.id, label: 'Jump to: ' + h.text, secondary: `H${h.level}`, kind: 'heading' as const, run: () => { location.hash = '#' + h.id; setPalette(false); } })),
    { id: 'cmd:sidebar', label: 'Toggle sidebar', kind: 'cmd', run: () => { setSidebar(!sidebarVisible); setPalette(false); } },
    { id: 'cmd:toc', label: 'Toggle TOC', kind: 'cmd', run: () => { setToc(!tocVisible); setPalette(false); } },
    { id: 'cmd:theme', label: 'Toggle theme', kind: 'cmd', run: () => { toggleTheme(); setPalette(false); } },
    { id: 'cmd:print', label: 'Print / Save as PDF', kind: 'cmd', run: () => { window.print(); setPalette(false); } },
    { id: 'cmd:find', label: 'Find in document', kind: 'cmd', run: () => { useStore.getState().setFind(true); setPalette(false); } },
    { id: 'cmd:refresh', label: 'Force re-render', kind: 'cmd', run: () => { void refreshActive(); setPalette(false); } },
    ...(activeDoc ? [
      { id: 'cmd:reveal', label: 'Reveal in Finder', kind: 'cmd' as const, run: () => { void invoke('reveal_in_finder', { path: activeDoc.path }); setPalette(false); } },
      { id: 'cmd:copypath', label: 'Copy path', kind: 'cmd' as const, run: () => { void invoke('copy_path', { path: activeDoc.path }); setPalette(false); } },
    ] : []),
  ];

  const filtered = query
    ? items.map(i => ({ item: i, s: score(query, i.label + ' ' + (i.secondary ?? '')) })).filter(x => x.s > -Infinity).sort((a, b) => b.s - a.s).slice(0, 50).map(x => x.item)
    : items.slice(0, 50);

  const clampedSelected = Math.min(selected, filtered.length - 1);

  if (!paletteOpen) return null;

  return (
    <div className="peekmd-palette-backdrop" onClick={() => setPalette(false)}>
      <div className="peekmd-palette" role="dialog" aria-label="Command palette" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="peekmd-palette-input"
          type="text"
          aria-label="Command palette"
          placeholder="Search commands, docs, headings…"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); filtered[clampedSelected]?.run(); }
            else if (e.key === 'Escape') { e.preventDefault(); setPalette(false); }
          }}
        />
        <ul ref={listRef} className="peekmd-palette-list" role="listbox">
          {filtered.map((item, idx) => (
            <li
              key={item.id}
              className={`peekmd-palette-item peekmd-palette-kind-${item.kind}${idx === clampedSelected ? ' is-selected' : ''}`}
              role="option"
              aria-selected={idx === clampedSelected}
              onClick={() => item.run()}
              onMouseEnter={() => setSelected(idx)}
            >
              <span className="peekmd-palette-label">{item.label}</span>
              {item.secondary && <span className="peekmd-palette-secondary">{item.secondary}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
