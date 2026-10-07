import { link } from '../app';
import type { ClusterStore, WsMessage } from './cluster';

const MAX_BACKOFF_MS = 10_000;

/**
 * Connects the store to the backend event stream and keeps it connected.
 * The server sends a full snapshot on every (re)connect, so there is no
 * client-side catch-up logic.
 */
export function connectWebSocket(store: ClusterStore, url = defaultWsUrl()): () => void {
  let attempt = 0;
  let closed = false;
  let ws: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = (): void => {
    if (closed) return;
    link.set('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
      link.set('online');
    };
    ws.onmessage = (ev: MessageEvent<string>) => {
      try {
        store.apply(JSON.parse(ev.data) as WsMessage);
      } catch (err) {
        console.error('ws: bad message', err);
      }
    };
    ws.onerror = () => ws?.close();
    ws.onclose = () => {
      if (closed) return;
      link.set('offline');
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++);
      timer = setTimeout(open, delay);
    };
  };
  open();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}

function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
