/** Subsequence match. Returns -Infinity for no match; higher = better. */
export function score(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return 100 + (q === t ? 50 : 0) + (t.startsWith(q) ? 20 : 0);
  // subsequence
  let qi = 0, gaps = 0, last = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (last >= 0) gaps += ti - last - 1;
      last = ti;
      qi++;
    }
  }
  if (qi < q.length) return -Infinity;
  return 50 - gaps + (last === 0 ? 10 : 0);
}
