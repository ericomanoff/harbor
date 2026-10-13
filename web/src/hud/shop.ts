import { helm, type HelmChart } from '../api/client';
import { mode, store } from '../app';
import { openOverlay } from '../ui/overlay';
import { openTechTree } from '../ui/techTree';
import { openGateForm } from '../ui/gateForm';
import { openLighthouseForm } from '../ui/lighthouseForm';
import { openOrdersForm } from '../ui/ordersForm';
import { openFleetForm } from '../ui/fleetForm';
import { openApplyForm } from '../ui/applyForm';
import { openJobForm } from '../ui/jobForm';

type Tab = 'all' | 'shipyards' | 'harbor' | 'charts';

/** The shop drawer: structures to build and charts to lay down. */
export function openShop(): void {
  const root = document.getElementById('shop')!;
  const rows = root.querySelector<HTMLDivElement>('.cards')!;
  const tabs = root.querySelectorAll<HTMLElement>('[data-tab]');
  document.body.classList.add('shop-open');
  const close = openOverlay('shop', () => document.body.classList.remove('shop-open'));
  root.querySelector<HTMLButtonElement>('button[data-close]')!.onclick = close;

  const card = (opts: { icon: string; title: string; sub: string; button: string; kind: 'primary' | 'secondary'; enabled: boolean; onClick?: () => void; id?: string }): HTMLElement => {
    const c = document.createElement('div');
    c.className = 'shop-card';
    if (opts.id) c.dataset['card'] = opts.id;
    c.innerHTML = `<div class="art">${opts.icon}</div><div class="title"></div><div class="sub"></div>`;
    c.querySelector('.title')!.textContent = opts.title;
    c.querySelector('.sub')!.textContent = opts.sub;
    const b = document.createElement('button');
    b.className = `pill ${opts.kind}`;
    b.textContent = opts.button;
    b.disabled = !opts.enabled;
    b.onclick = () => { opts.onClick?.(); };
    c.append(b);
    return c;
  };

  let charts: HelmChart[] | undefined;
  const render = async (tab: Tab): Promise<void> => {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset['tab'] === tab));
    const out: HTMLElement[] = [];
    if (tab === 'all' || tab === 'shipyards') {
      out.push(card({ id: 'shipyard', icon: '⚓', title: 'Shipyard', sub: 'Deployment', button: 'Build', kind: 'primary', enabled: store.nodes.size > 0, onClick: () => { close(); mode.set('place', 'Deployment'); } }));
      out.push(card({ id: 'terminal', icon: '🛢️', title: 'Tanker terminal', sub: 'StatefulSet', button: 'Build', kind: 'primary', enabled: store.nodes.size > 0, onClick: () => { close(); mode.set('place', 'StatefulSet'); } }));
      out.push(card({ id: 'fleet', icon: '🎣', title: 'Fishing fleet', sub: 'Job', button: 'Set sail', kind: 'primary', enabled: store.nodes.size > 0, onClick: () => { close(); openJobForm(); } }));
    }
    if (tab === 'all' || tab === 'harbor') {
      out.push(card({ id: 'gate', icon: '⛩', title: 'Gate', sub: 'Ingress', button: 'Open', kind: 'primary', enabled: store.services.size > 0, onClick: () => { close(); openGateForm(); } }));
      out.push(card({ id: 'lighthouse', icon: '🗼', title: 'Lighthouse', sub: 'Service', button: 'Light', kind: 'primary', enabled: store.namespaces.size > 0, onClick: () => { close(); openLighthouseForm(); } }));
      out.push(card({ id: 'orders', icon: '📜', title: 'Sealed orders', sub: 'ConfigMap · Secret', button: 'Seal', kind: 'primary', enabled: store.namespaces.size > 0, onClick: () => { close(); openOrdersForm(); } }));
      out.push(card({ id: 'fleet-ns', icon: '⚑', title: 'New fleet', sub: 'Namespace', button: 'Found', kind: 'primary', enabled: store.nodes.size > 0, onClick: () => { close(); openFleetForm(); } }));
      out.push(card({ id: 'apply', icon: '📜', title: 'Apply manifest', sub: 'kubectl apply', button: 'Open', kind: 'secondary', enabled: store.nodes.size > 0, onClick: () => { close(); openApplyForm(); } }));
    }
    if (tab === 'all' || tab === 'charts') {
      if (!charts) {
        try {
          charts = await helm.searchCharts('');
        } catch {
          charts = [];
        }
      }
      for (const ch of charts.slice(0, tab === 'all' ? 6 : 60)) {
        out.push(card({ icon: '🗺️', title: ch.name, sub: `${ch.repo} · ${ch.version}`, button: 'Chart', kind: 'secondary', enabled: true, onClick: () => { close(); openTechTree({ install: ch }); } }));
      }
      out.push(card({ icon: '📚', title: 'Chart library', sub: 'repositories', button: 'Open', kind: 'secondary', enabled: true, onClick: () => { close(); openTechTree({ tab: 'repos' }); } }));
    }
    rows.replaceChildren(...out);
  };
  tabs.forEach((t) => { t.onclick = () => void render(t.dataset['tab'] as Tab); });
  void render('all');
}
