export function scrollToChange(prevHtml: string, nextHtml: string, container: HTMLElement) {
  const prevDoc = new DOMParser().parseFromString(prevHtml, 'text/html');
  const nextDoc = new DOMParser().parseFromString(nextHtml, 'text/html');
  const prevBlocks = Array.from(prevDoc.body.children);
  const nextBlocks = Array.from(nextDoc.body.children);

  const len = Math.max(prevBlocks.length, nextBlocks.length);
  let targetIdx = -1;
  for (let i = 0; i < len; i++) {
    const a = prevBlocks[i], b = nextBlocks[i];
    if (!a || !b || a.getAttribute('data-sourcepos') !== b.getAttribute('data-sourcepos')
        || a.textContent !== b.textContent) { targetIdx = i; break; }
  }
  if (targetIdx < 0) return;

  const liveBlocks = Array.from(container.querySelectorAll<HTMLElement>('.markdown-body > *'));
  const el = liveBlocks[targetIdx];
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const alreadyVisible = rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
  if (!alreadyVisible) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('change-flash');
  setTimeout(() => el.classList.remove('change-flash'), 1600);
}
