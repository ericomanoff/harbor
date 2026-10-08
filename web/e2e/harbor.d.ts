/** The devtools handle the game exposes, as the e2e specs use it. */
interface HarborWindow {
  game: { scene: { keys: Record<string, unknown> } };
  selection: { keys: Set<string> };
  mode: { current: string };
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
