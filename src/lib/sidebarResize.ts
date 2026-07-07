import { useCallback, useEffect, useRef } from 'react';

const STORAGE_KEY = 'peekmd-sidebar-width';
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 140;
const MAX_WIDTH = 480;

function clamp(v: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));
}

function readStored(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_WIDTH;
  const n = parseInt(raw, 10);
  return isNaN(n) ? DEFAULT_WIDTH : clamp(n);
}

/**
 * Returns [widthRef, handleProps] where:
 *   - widthRef.current is the live pixel width (use as inline style)
 *   - handleProps should be spread onto the drag-handle element
 *
 * Width is persisted to localStorage and restored on mount.
 * The hook drives the sidebar width via a CSS custom property on
 * the nearest `.peekmd-main-area` ancestor so no React re-render
 * is needed on every mousemove frame.
 */
export function useSidebarResize(areaRef: React.RefObject<HTMLDivElement | null>) {
  const widthRef = useRef(readStored());

  // Apply the stored width once on mount.
  useEffect(() => {
    areaRef.current?.style.setProperty('--sidebar-width', `${widthRef.current}px`);
  }, [areaRef]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const w = clamp(startW + ev.clientX - startX);
      widthRef.current = w;
      areaRef.current?.style.setProperty('--sidebar-width', `${w}px`);
    };

    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(STORAGE_KEY, String(widthRef.current));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [areaRef]);

  return { onMouseDown };
}
