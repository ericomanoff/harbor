import { ClusterStore } from './store/cluster';

/** Minimal typed emitter for cross-scene state. */
export class Emitter<T> {
  private readonly fns = new Set<(v: T) => void>();
  on(fn: (v: T) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(v: T): void {
    for (const fn of this.fns) fn(v);
  }
}

export type LinkStatus = 'connecting' | 'online' | 'offline' | 'demo';

/** Backend link state, shown on the sidebar. */
export const link = {
  status: 'connecting' as LinkStatus,
  changed: new Emitter<LinkStatus>(),
  set(s: LinkStatus): void {
    this.status = s;
    this.changed.emit(s);
  },
};

/** What the player has selected: keys of buildings ("b:ns/name") or units ("u:ns/name"). */
export class Selection {
  readonly keys = new Set<string>();
  readonly changed = new Emitter<ReadonlySet<string>>();
  set(keys: Iterable<string>): void {
    this.keys.clear();
    for (const k of keys) this.keys.add(k);
    this.changed.emit(this.keys);
  }
  clear(): void {
    this.set([]);
  }
}

export const settings = {
  showSystemNamespaces: false,
  hiddenNamespaces: new Set<string>(),
  sound: false,
  changed: new Emitter<void>(),
};

export type Mode = 'idle' | 'place';

/** What the pointer does on the map: select things, or place a War Factory. */
export type PlaceKind = 'Deployment' | 'StatefulSet';

export const mode = {
  current: 'idle' as Mode,
  /** What a placement will create; shipyard by default. */
  placeKind: 'Deployment' as PlaceKind,
  changed: new Emitter<Mode>(),
  set(m: Mode, kind: PlaceKind = 'Deployment'): void {
    if (m === 'place') this.placeKind = kind;
    if (this.current === m) return;
    this.current = m;
    this.changed.emit(m);
  },
};

/** True while an HTML form covers the game; scenes must ignore keys then. */
export const modal = {
  open: false,
  changed: new Emitter<boolean>(),
  set(v: boolean): void {
    this.open = v;
    this.changed.emit(v);
  },
};

/** The active data source (WebSocket or demo); the tour swaps it for the training harbor. */
export const source: { stop?: () => void } = {};

/** EVA announcements from anywhere; the HUD shows them in the log. */
export const eva = new Emitter<string>();

export const store = new ClusterStore();
export const selection = new Selection();
