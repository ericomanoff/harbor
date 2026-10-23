/** The devtools handle the game exposes, as the e2e specs use it. */
interface HarborWindow {
  game: { scene: { keys: Record<string, unknown> } };
  selection: { keys: Set<string>; set(keys: Iterable<string>): void; clear(): void };
  mode: { current: string };
  modal: { open: boolean };
  settings: { bothLanguages: boolean; hiddenNamespaces: Set<string>; changed: { emit(): void } };
  store: {
    context: string;
    deployments: Map<string, { replicas: number; available: number }>;
    pods: Map<string, { name: string; ready: boolean; deployment?: string }>;
  };
}
declare global {
  interface Window {
    harbor: HarborWindow;
  }
}
export {};
