# Persistence

PeekMD persists session state across launches using `tauri-plugin-store`. The store is a JSON file managed by the plugin; PeekMD does not write it directly.

## Store file location

```
~/Library/Application Support/com.peekmd.desktop/state.json
```

The identifier `com.peekmd.desktop` comes from `tauri.conf.json`. The path is resolved by the plugin at runtime; the frontend references only the filename `state.json`.

## Plugin: LazyStore

**Source:** `src/lib/persistence.ts`.

```ts
import { LazyStore } from '@tauri-apps/plugin-store';
const store = new LazyStore('state.json');
```

`LazyStore` defers opening the file until the first read or write, avoiding startup I/O in the common case where `hydrateFromDisk` resolves quickly. The underlying plugin (`tauri-plugin-store`) is registered in `src-tauri/src/lib.rs`:

```rust
.plugin(tauri_plugin_store::Builder::default().build())
```

## Schema

```ts
type Persisted = {
  version: number;           // must equal 2; any other value → start fresh
  openDocs: string[];        // absolute paths in display order
  activeDoc: string | null;  // absolute path of the active document
  rightPaneDoc: null;        // always null; slot reserved for Phase 3 split view
  recentlyClosed: PersistedRecentEntry[];
  scrollPositions: Record<string, number>;  // scrollTop per absolute path
  ui: PersistedUi;
};

type PersistedRecentEntry = {
  path: string;
  title: string;
  closedAt: string;          // ISO 8601 timestamp
};

type PersistedUi = {
  sidebarVisible: boolean;
  tocVisible: boolean;
  themeOverride: 'light' | 'dark' | null;
};
```

Fields not present in this schema (`paletteOpen`, `findOpen`, `navBack`, `navForward`) are ephemeral — they live only in the Zustand store for the lifetime of a session.

### rightPaneDoc

This field is written as `null` unconditionally and read as `null` unconditionally. The slot exists so that the Phase 3 split-view feature can begin persisting a right-pane document path without a schema migration. In Phase 3 the type will change to `string | null`.

### navBack / navForward

Navigation history is not persisted. On launch, `navBack` and `navForward` are both empty arrays (`[]` in the Zustand initial state). The history only accumulates for the current session — `activate` with `pushHistory: true` (the default for `openFile` and user-initiated tab clicks) appends to `navBack` and clears `navForward`.

## Version guard

`loadState` reads the `version` key first:

```ts
const v = await store.get<number>('version');
if (v !== CURRENT_VERSION) return null;
```

`CURRENT_VERSION` is `2`. Any other value — including `undefined` (first launch) or a future integer — returns `null`. The caller (`hydrateFromDisk`) treats `null` as "no state to restore" and starts fresh. There is no migration path yet; the old file is left in place (the plugin will overwrite it on the next `scheduleSave`).

## Write debounce

`scheduleSave` (called from `App.tsx` via a Zustand `subscribe` listener) debounces writes by 500 ms:

```ts
export function scheduleSave(getState: () => Persisted): void {
  clearTimeout(saveTimer ?? undefined);
  saveTimer = setTimeout(async () => {
    const s = getState();
    await store.set('version', s.version);
    await store.set('openDocs', s.openDocs);
    await store.set('activeDoc', s.activeDoc);
    await store.set('rightPaneDoc', null);
    await store.set('recentlyClosed', s.recentlyClosed);
    await store.set('scrollPositions', s.scrollPositions);
    await store.set('ui', s.ui);
    await store.save();
  }, 500);
}
```

`store.save()` flushes the in-memory plugin state to disk. Without it the plugin holds the values in memory but does not write the file.

## Session restore: hydrateFromDisk

`hydrateFromDisk` is called once during `App.tsx`'s `useEffect` on mount. It runs after the Tauri webview is ready.

```ts
hydrateFromDisk: async () => {
  const persisted = await loadState();
  if (!persisted) return;
  // 1. Apply UI state immediately (sidebar visibility, TOC, theme override).
  //    Force paletteOpen and findOpen to false — they should never survive a restart.
  set(s => ({ ui: { ...s.ui, ...persisted.ui, paletteOpen: false, findOpen: false },
              recentlyClosed: persisted.recentlyClosed }));
  // 2. Open each persisted path sequentially, without touching nav history.
  const validPaths: string[] = [];
  for (const p of persisted.openDocs) {
    try {
      await get().openFile(p, { pushHistory: false });
      validPaths.push(p);
    } catch { /* file missing — skip silently */ }
  }
  // 3. Restore activeDoc only if it was successfully opened.
  if (persisted.activeDoc && validPaths.includes(persisted.activeDoc)) {
    get().activate(persisted.activeDoc, { pushHistory: false });
  }
  // 4. Defensive reset: guarantees navBack/navForward are empty regardless
  //    of how many docs were opened above.
  set({ navBack: [], navForward: [] });
},
```

Key behaviours:

- **Missing files trigger an info toast.** If any persisted paths no longer exist, they are skipped and a one-time info toast is shown with the count (e.g. `"2 file(s) missing from last session"`). The missing path is omitted from `validPaths`.
- **UI state is applied before docs are opened.** This prevents a visible layout shift from the defaults.
- **`pushHistory: false` throughout restore.** `openFile` takes an optional `{ pushHistory }` option (default `true`); hydration passes `false` for every restored doc, and the final `activate` call also passes `false`. Combined with an unconditional `navBack`/`navForward` reset at the end, restoring N open docs never seeds navigation history — it starts clean every session, per the SPEC. (Earlier versions called the history-less `activate` only once at the end, but `openFile` itself always pushed history internally while opening each doc in the loop, so `navBack` ended up with `N-1` stale entries. This is now closed at both the source and with a defensive reset.)
- **`paletteOpen` and `findOpen` are forced to `false`.** These are transient UI states that should never be open at launch even if a crash left them `true` in the store.
- **`ui.themeOverride` is applied by `App.tsx`, not here.** `hydrateFromDisk` only loads the value into the store; a separate `useStore.subscribe` in `App.tsx` calls `applyTheme` whenever `ui.themeOverride` changes (including the change hydration itself causes), so the persisted override actually takes effect after a relaunch. See [Theme](#theme) below.

## Theme

`ui.themeOverride` (`'light' | 'dark' | null`, `null` = follow system) is persisted exactly like the other `ui.*` fields — there is no separate storage mechanism. `src/lib/theme.ts` is stateless: it only resolves an override to `'light' | 'dark'` (`resolveTheme`) and applies it to `data-theme` on `<html>` (`applyTheme`). `⌘⇧D` (`toggleTheme` in `store.ts`) flips `ui.themeOverride` between `'light'` and `'dark'` based on the currently resolved theme; there is no keyboard shortcut back to "follow system" (matches the SPEC: "Follows system by default; ⌘⇧D forces the other").

`App.tsx` keeps the DOM in sync with the store in one place:

```ts
applyTheme(useStore.getState().ui.themeOverride);
const unsubTheme = useStore.subscribe((state, prev) => {
  if (state.ui.themeOverride !== prev.ui.themeOverride) applyTheme(state.ui.themeOverride);
});
const unsubSystemTheme = watchSystemTheme(() => {
  if (useStore.getState().ui.themeOverride === null) applyTheme(null);
});
```

`main.tsx` calls `applyTheme(null)` once, synchronously, before the store hydrates — this is a best-effort first paint (system theme) to avoid a flash of unstyled content while `hydrateFromDisk`'s async IPC round-trip to `tauri-plugin-store` resolves. Once hydration completes, the subscription above re-applies the real persisted override (if any).

## Persisted vs ephemeral state

| Field | Persisted | Notes |
| --- | --- | --- |
| `openDocs` (paths) | Yes | Stored as ordered array of absolute paths |
| `activeDoc` | Yes | |
| `rightPaneDoc` | Yes (always `null`) | Phase 3 slot |
| `recentlyClosed` | Yes | Up to 20 entries with ISO timestamps |
| `scrollPositions` | Yes | `scrollTop` per absolute path; restored on session start |
| `ui.sidebarVisible` | Yes | |
| `ui.tocVisible` | Yes | |
| `ui.themeOverride` | Yes | `null` means follow system |
| `ui.paletteOpen` | No | Reset to `false` on restore |
| `ui.findOpen` | No | Reset to `false` on restore |
| `navBack` | No | In-memory only |
| `navForward` | No | In-memory only |
| `openDocs[*].html` | No | Re-rendered on open |
| `openDocs[*].headings` | No | Re-extracted on open |
| `openDocs[*].dirty` | No | Starts `false` on open |
