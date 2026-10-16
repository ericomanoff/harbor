import { deleteDeployment, deleteIngress, deletePod, helm, rollbackDeployment, scaleDeployment, workloads as workloadApi, type HelmRelease, deleteService } from '../api/client';
import { openRefitForm } from '../ui/refitForm';
import { openEnsignForm } from '../ui/ensignForm';
import { openLedger } from '../ui/ledgerPanel';
import { openPapers } from '../ui/papersPanel';
import { hullNumber, shipVariant } from '../entities/Ship';
import { eva, link, mode, modal, selection, settings, store, type LinkStatus } from '../app';
import { sfx } from '../game/audio';
import { sellPlan } from '../game/commands';
import { EvaFeed } from '../game/eva';
import { filterSummary } from '../game/filter';
import { computePower, formatPower, type PowerLevel } from '../game/power';
import { ingressesForService, podsForService, servicesForIngress } from '../game/selector';
import { voiceLineFor } from '../game/voice';
import { hexString, namespaceColor } from '../layout/colors';
import { nsKey, wlKey, type StoreEvent, type Workload } from '../store/cluster';
import { openFilter } from '../ui/filterPanel';
import { openLogs } from '../ui/logsPanel';
import { openMissionSelect } from '../ui/missionSelect';
import { openSearch } from '../ui/searchBox';
import { openTechTree } from '../ui/techTree';
import { openMinimap, type MapApi } from './minimap';
import { openShop } from './shop';
import { Toasts } from './toasts';
import { glossaryTooltip, openGlossary, startGlossary } from '../glossary';

export type { MapApi } from './minimap';

interface Action {
  label: string;
  kind: 'primary' | 'secondary' | 'danger';
  enabled: boolean;
  run?: () => Promise<void>;
  confirm?: string;
}

const CONFIRM_MS = 4000;
const LOG_MAX = 300;

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`hud: missing ${sel}`);
  return el;
};

/**
 * The HTML HUD. Mounted once by the map scene; everything it shows comes
 * from the store, selection, mode and settings emitters, and every command
 * goes through the same API client the old sidebar used.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly toasts: Toasts;
  private readonly feed = new EvaFeed(store);
  private readonly history: { t: Date; line: string }[] = [];
  private readonly relDetails = new Map<string, HelmRelease>();
  private actions: Action[] = [];
  private pendingConfirm?: { index: number; until: number };
  private powerLevel: PowerLevel = 'ok';

  constructor(private readonly map: MapApi) {
    this.root = $('#hud');
    this.root.hidden = false;
    this.toasts = new Toasts($('.toasts', this.root));

    $('[data-badge]', this.root).onclick = () => openMissionSelect();
    $('[data-rail=map]', this.root).onclick = () => openMinimap(this.map);
    $('[data-rail=log]', this.root).onclick = () => this.openLog();
    $('[data-rail=locate]', this.root).onclick = () => this.map.openSearch();
    $('[data-rail=fleets]', this.root).onclick = () => openFilter();
    $('[data-rail=settings]', this.root).onclick = () => this.openSettings();
    $('[data-rail=zoom-in]', this.root).onclick = () => this.map.zoomBy(1.25);
    $('[data-rail=zoom-out]', this.root).onclick = () => this.map.zoomBy(0.8);
    $('[data-rail=home]', this.root).onclick = () => this.map.home();
    $('[data-rail=sound]', this.root).onclick = () => {
      settings.sound = !settings.sound;
      sfx.setEnabled(settings.sound);
      settings.changed.emit();
    };
    $('[data-shop-open]', this.root).onclick = () => openShop();
    $('[data-tech]', this.root).onclick = () => openTechTree();
    $('[data-rail=glossary]', this.root).onclick = () => openGlossary();
    $('[data-rail=ledger]', this.root).onclick = () => openLedger();
    startGlossary();
    this.map.onHover((key, rect) => this.hoverTip(key, rect));

    store.subscribe((e) => this.onStore(e));
    link.changed.on((s) => this.setLink(s));
    selection.changed.on(() => {
      this.pendingConfirm = undefined;
      this.refreshSelection();
    });
    mode.changed.on(() => this.refreshSelection());
    settings.changed.on(() => this.refreshStatus());
    eva.on((line) => this.announce(line));

    this.setLink(link.status);
    this.onStore({ type: 'snapshot' });
    window.setInterval(() => this.tickConfirm(), 250);
  }

  /** Map hover: the glossary entry for the kind of thing under the pointer. */
  private hoverTip(key: string | undefined, rect: { x: number; y: number; width: number; height: number } | undefined): void {
    const tip = glossaryTooltip();
    if (!tip) return;
    if (!key || !rect) {
      tip.hide();
      return;
    }
    const id = key.startsWith('b:sts:') ? 'tanker-terminal' : key.startsWith('b:') ? 'shipyard' : key.startsWith('s:') ? 'lighthouse' : key.startsWith('g:') ? 'gate' : key.startsWith('r:') ? 'anchorage' : key.startsWith('dock:') ? 'dock' : 'ship';
    tip.showFor(id, new DOMRect(rect.x, rect.y, rect.width, rect.height), false);
  }

  // ---- top bar -----------------------------------------------------------

  private refreshStatus(): void {
    $('[data-harbor-name]', this.root).textContent = store.context || 'no harbor';
    $('[data-berths-count]', this.root).textContent = String(store.nodes.size);
    const ready = [...store.nodes.values()].filter((n) => n.ready).length;
    const ships = store.pods.size;
    const readyShips = [...store.pods.values()].filter((p) => p.ready).length;
    $('[data-chip=docks]', this.root).textContent = `${ready}/${store.nodes.size} docks ready`;
    $('[data-chip=fleet]', this.root).textContent = `${readyShips}/${ships} ships ready`;
    $('[data-chip=fleets]', this.root).textContent = filterSummary(store.namespaces.keys(), settings).toLowerCase();
    $('[data-rail=sound] .glyph', this.root).textContent = settings.sound ? '🔔' : '🔕';

    const p = computePower(store.nodes.values());
    const colors: Record<PowerLevel, string> = { ok: 'var(--gold)', low: '#f29b2a', critical: 'var(--red)' };
    const berths = $('[data-bar=berths]', this.root);
    $('.fill', berths).style.width = `${Math.min(100, Math.round(p.frac * 100))}%`;
    $('.fill', berths).style.background = colors[p.level];
    $('.value', berths).textContent = p.alloc ? `${(p.req / 1000).toFixed(1)} / ${(p.alloc / 1000).toFixed(0)}` : '—';
    berths.title = `CPU requests over allocatable on ready docks: ${formatPower(p)}`;
    let memReq = 0;
    let memAlloc = 0;
    for (const n of store.nodes.values()) {
      if (!n.ready) continue;
      memReq += n.memReq;
      memAlloc += n.memAlloc;
    }
    const cargo = $('[data-bar=cargo]', this.root);
    const gib = (b: number): string => (b / 1024 ** 3).toFixed(1);
    $('.fill', cargo).style.width = `${memAlloc ? Math.min(100, Math.round((memReq / memAlloc) * 100)) : 0}%`;
    $('.value', cargo).textContent = memAlloc ? `${gib(memReq)} / ${gib(memAlloc)} GiB` : '—';
    cargo.title = 'Memory requests over allocatable on ready docks';
    const crew = $('[data-bar=crew]', this.root);
    $('.fill', crew).style.width = `${ships ? Math.round((readyShips / ships) * 100) : 0}%`;
    $('.value', crew).textContent = `${readyShips} / ${ships}`;
    crew.title = 'Ships ready over ships afloat';

    if (p.level !== this.powerLevel) {
      this.powerLevel = p.level;
      if (p.level === 'critical') this.announce('INSUFFICIENT POWER');
      else if (p.level === 'low') this.announce('LOW POWER');
    }
  }

  private setLink(s: LinkStatus): void {
    const chip = $('[data-chip=link]', this.root);
    const label: Record<LinkStatus, string> = { connecting: 'connecting…', online: 'link ok', offline: 'link lost', demo: 'demo' };
    chip.textContent = label[s];
    chip.dataset['state'] = s;
    if (s === 'offline') this.announce('LINK TO BACKEND LOST');
  }

  // ---- toasts and log ----------------------------------------------------

  private announce(line: string): void {
    const voice = voiceLineFor(line);
    if (/^UNABLE|^CANNOT|^INSUFFICIENT|^LINK/.test(line)) sfx.play('error');
    else if (/under attack/.test(voice ?? '')) sfx.play('alert');
    else if (/^CONSTRUCTION STARTED|^UNIT ORDERED|^EXPANSION ORDERED/.test(line)) sfx.play('build');
    else if (/^CONSTRUCTION COMPLETE|^UNIT DEPLOYED|^EXPANSION ONLINE/.test(line)) sfx.play('ok');
    sfx.say(voice);
    const pretty = navalise(line);
    this.toasts.push(pretty, /UNABLE|LOST|FAILED|INSUFFICIENT|attack|BackOff|CrashLoop/i.test(line) ? 'warn' : 'info');
    this.history.push({ t: new Date(), line: pretty });
    if (this.history.length > LOG_MAX) this.history.splice(0, this.history.length - LOG_MAX);
  }

  private openLog(): void {
    const root = $('#log');
    const list = $('.rows', root);
    list.replaceChildren(...[...this.history].reverse().map((h) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="muted">${h.t.toLocaleTimeString()}</span><span class="desc"></span>`;
      $('.desc', row).textContent = h.line;
      return row;
    }));
    if (this.history.length === 0) list.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Nothing logged yet.' }));
    const close = openOverlayHere('log');
    $('button[data-close]', root).onclick = close;
  }

  private openSettings(): void {
    const root = $('#settings');
    const close = openOverlayHere('settings');
    $('button[data-close]', root).onclick = close;
    $('[data-set=theater]', root).onclick = () => { close(); openMissionSelect(); };
    $('[data-set=fleets]', root).onclick = () => { close(); openFilter(); };
    $('[data-set=tech]', root).onclick = () => { close(); openTechTree(); };
    const sound = $('[data-set=sound]', root);
    const sys = $('[data-set=system]', root);
    const both = $('[data-set=both]', root);
    const refresh = (): void => {
      sound.textContent = settings.sound ? 'Sound: on' : 'Sound: off';
      sys.textContent = settings.showSystemNamespaces ? 'System fleets: shown' : 'System fleets: hidden';
      both.textContent = settings.bothLanguages ? 'Both languages: harbor (Kubernetes)' : 'Both languages: off';
    };
    both.onclick = () => { settings.bothLanguages = !settings.bothLanguages; settings.changed.emit(); refresh(); };
    sound.onclick = () => { settings.sound = !settings.sound; sfx.setEnabled(settings.sound); settings.changed.emit(); refresh(); };
    sys.onclick = () => { settings.showSystemNamespaces = !settings.showSystemNamespaces; settings.changed.emit(); refresh(); };
    refresh();
  }

  // ---- selection card ----------------------------------------------------

  private tickConfirm(): void {
    if (this.pendingConfirm && Date.now() > this.pendingConfirm.until) {
      this.pendingConfirm = undefined;
      this.renderActions();
    }
  }

  private setCard(title: string, lines: string[], actions: Action[], accent?: number): void {
    const card = $('.selection', this.root);
    card.hidden = false;
    $('.title', card).textContent = title;
    $('.title', card).style.color = accent !== undefined ? hexString(accent) : 'var(--ink)';
    $('.lines', card).replaceChildren(...lines.filter(Boolean).map((l) => Object.assign(document.createElement('div'), { textContent: l })));
    // Cards re-render on every store event; an armed confirm must survive
    // that as long as the same action is still offered.
    const pending = this.pendingConfirm;
    this.actions = actions;
    if (pending && actions[pending.index]?.confirm !== this.pendingLabel) this.pendingConfirm = undefined;
    this.renderActions();
  }

  private pendingLabel?: string;

  private renderActions(): void {
    const box = $('.selection .actions', this.root);
    box.replaceChildren(...this.actions.map((a, i) => {
      const b = document.createElement('button');
      const confirming = this.pendingConfirm?.index === i;
      b.className = `pill ${confirming ? 'danger' : a.kind}`;
      b.textContent = confirming ? (a.confirm ?? a.label) : a.label;
      b.disabled = !a.enabled;
      b.dataset['action'] = String(i);
      b.onclick = () => void this.run(i);
      return b;
    }));
  }

  private async run(i: number): Promise<void> {
    const a = this.actions[i];
    if (!a?.run || !a.enabled) return;
    sfx.play('click');
    if (a.confirm && this.pendingConfirm?.index !== i) {
      this.pendingConfirm = { index: i, until: Date.now() + CONFIRM_MS };
      this.pendingLabel = a.confirm;
      this.renderActions();
      return;
    }
    this.pendingConfirm = undefined;
    this.pendingLabel = undefined;
    this.renderActions();
    try {
      await a.run();
    } catch (e) {
      this.announce(`UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async loadReleaseDetails(key: string): Promise<void> {
    try {
      for (const r of await helm.listReleases()) this.relDetails.set(`${r.ns}/${r.name}`, r);
    } catch {
      /* live status only */
    }
    if (selection.keys.has(`r:${key}`)) this.refreshSelection();
  }

  private refreshSelection(): void {
    const card = $('.selection', this.root);
    if (mode.current === 'place') {
      this.setCard(mode.placeKind === 'StatefulSet' ? 'Place a tanker terminal' : 'Place a shipyard', ['Click a free slipway on an island (the land rows).', 'Green is clear, red is blocked. Right-click or Esc cancels.'],
        [{ label: 'Cancel', kind: 'secondary', enabled: true, run: async () => mode.set('idle') }]);
      return;
    }
    const keys = [...selection.keys];
    if (keys.length === 0) {
      card.hidden = true;
      return;
    }
    const k0 = keys[0]!;
    if (keys.length === 1 && k0.startsWith('b:sts:')) {
      const w = store.workloads.get(wlKey('StatefulSet', ...splitNs(k0.slice(6))));
      if (!w) return;
      this.setCard(`Tanker terminal ${w.name}`, [
        `${w.ns} · ${w.image} · StatefulSet`,
        `${w.ready}/${w.desired} tankers moored · hull numbers retire highest first`,
        w.mapPos ? `berth ${w.mapPos.x},${w.mapPos.y}` : 'auto-berthed (drag to choose a site)',
      ], [
        { label: 'Launch tanker', kind: 'primary', enabled: true, run: async () => { await workloadApi.scale('StatefulSet', w.ns, w.name, w.desired + 1); this.announce(`UNIT ORDERED: ${w.name}`); } },
        { label: 'Scrap one', kind: 'secondary', enabled: w.desired > 0, run: async () => { await workloadApi.scale('StatefulSet', w.ns, w.name, w.desired - 1); this.announce(`UNIT RETIRED: ${w.name}`); } },
        { label: 'Sell terminal', kind: 'danger', confirm: 'Confirm: sell and lose its tankers?', enabled: true, run: async () => { await workloadApi.remove('StatefulSet', w.ns, w.name); selection.clear(); } },
      ], namespaceColor(w.ns));
      return;
    }
    if (keys.length === 1 && k0.startsWith('w:')) {
      const [kind, rest] = [k0.slice(2).split(':')[0] ?? '', k0.slice(2).split(':').slice(1).join(':')];
      const w = store.workloads.get(wlKey(kind, ...splitNs(rest)));
      if (!w) return;
      this.workloadCard(w);
      return;
    }
    if (keys.length === 1 && k0.startsWith('b:')) {
      const d = store.deployments.get(k0.slice(2));
      if (!d) return;
      const rolling = d.replicas > 0 && d.updated < d.replicas;
      this.setCard(`Shipyard ${d.name}`, [
        `${d.ns} · ${d.image}`,
        `${d.available}/${d.replicas} ships moored${rolling ? ` · refit ${d.updated}/${d.replicas}` : ''}${d.revision ? ` · refit #${d.revision}` : ''}${d.strategy ? ` · ${d.strategy}` : ''}`,
        d.readiness || d.liveness ? `lookouts: readiness ${d.readiness ?? 'none'} · liveness ${d.liveness ?? 'none'}` : 'no lookouts (no probes)',
        `berth: requests ${d.requests ?? 'none (greedy ship)'} · limits ${d.limits ?? 'none'}`,
        d.orders?.length ? `sealed orders: ${d.orders.join(', ')}` : '',
        d.mapPos ? `berth ${d.mapPos.x},${d.mapPos.y}` : 'auto-berthed (drag to choose a site)',
      ], [
        { label: 'Launch ship', kind: 'primary', enabled: true, run: async () => { await scaleDeployment(d.ns, d.name, d.replicas + 1); this.announce(`UNIT ORDERED: ${d.name}`); } },
        { label: 'Scrap one', kind: 'secondary', enabled: d.replicas > 0, run: async () => { await scaleDeployment(d.ns, d.name, d.replicas - 1); this.announce(`UNIT RETIRED: ${d.name}`); } },
        { label: 'Sell shipyard', kind: 'danger', confirm: 'Confirm: sell and lose its ships?', enabled: true, run: async () => { await deleteDeployment(d.ns, d.name); selection.clear(); } },
        { label: 'Refit shipyard', kind: 'secondary', enabled: true, run: async () => openRefitForm(d) },
        { label: 'Papers', kind: 'secondary', enabled: true, run: async () => openPapers('Deployment', d.ns, d.name) },
        { label: 'Change ensign', kind: 'secondary', enabled: true, run: async () => openEnsignForm({ kind: 'Deployment', ns: d.ns, name: d.name, labels: { app: d.name, ...(d.templateLabels ?? {}) }, locked: ['app'] }) },
        { label: 'Roll back refit', kind: 'secondary', confirm: 'Confirm: return to the previous refit?', enabled: (d.revision ?? 1) > 1, run: async () => { await rollbackDeployment(d.ns, d.name); this.announce(`ROLLBACK ORDERED: ${d.name}`); } },
      ], namespaceColor(d.ns));
      return;
    }
    if (keys.length === 1 && k0.startsWith('s:')) {
      const sv = store.services.get(k0.slice(2));
      if (!sv) return;
      const linked = podsForService(sv, store.pods.values());
      this.setCard(`Lighthouse ${sv.name}`, [
        `${sv.ns} · ${sv.type} · ${sv.clusterIP || 'no ip'}`,
        `ports ${sv.ports.map((p) => `${p.port}→${p.targetPort}/${p.protocol}`).join(', ') || 'none'}`,
        `guides ${linked.length} ship${linked.length === 1 ? '' : 's'} (${linked.filter((p) => p.ready).length} ready)`,
        ingressesForService(sv, store.ingresses.values()).length ? `reached through gate ${ingressesForService(sv, store.ingresses.values()).map((k) => k.split('/')[1]).join(', ')}` : 'not reachable from outside',
        Object.keys(sv.selector).length ? `selector ${Object.entries(sv.selector).map(([k, v]) => `${k}=${v}`).join(',')}` : 'no selector',
      ], [
        { label: 'Papers', kind: 'secondary', enabled: true, run: async () => openPapers('Service', sv.ns, sv.name) },
        { label: 'Put out lighthouse', kind: 'danger', confirm: 'Confirm: delete the Service?', enabled: true, run: async () => { await deleteService(sv.ns, sv.name); selection.clear(); } },
      ], namespaceColor(sv.ns));
      return;
    }
    if (keys.length === 1 && k0.startsWith('g:')) {
      const ing = store.ingresses.get(k0.slice(2));
      if (!ing) return;
      const targets = servicesForIngress(ing);
      this.setCard(`Gate ${ing.name}`, [
        `${ing.ns} · Ingress${ing.class ? ` · class ${ing.class}` : ''}${ing.tls ? ' · 🔒 TLS' : ''}`,
        ing.hosts.length ? `hosts ${ing.hosts.join(', ')}` : 'any host',
        ...ing.rules.slice(0, 4).map((r) => `${r.host || '*'}${r.path || '/'} → lighthouse ${r.service}${r.port ? `:${r.port}` : ''}`),
        ing.rules.length > 4 ? `… ${ing.rules.length - 4} more rules` : '',
        ing.addresses.length ? `moored at ${ing.addresses.join(', ')}` : 'no address assigned yet',
        `${targets.length} lighthouse${targets.length === 1 ? '' : 's'} lit from this gate`,
      ], [
        { label: 'Close the gate', kind: 'danger', confirm: 'Confirm: delete the Ingress?', enabled: true, run: async () => { await deleteIngress(ing.ns, ing.name); selection.clear(); } },
      ], namespaceColor(ing.ns));
      return;
    }
    if (keys.length === 1 && k0.startsWith('r:')) {
      const key = k0.slice(2);
      const live = store.releases.get(key);
      if (!live) return;
      const det = this.relDetails.get(key);
      if (!det || det.revision !== live.revision) void this.loadReleaseDetails(key);
      this.setCard(`Anchorage ${live.name}`, [
        `${live.ns} · ${live.status} · revision ${live.revision}`,
        det?.chart ? `chart ${det.chart}-${det.chartVersion ?? ''}${det.appVersion ? ` · app ${det.appVersion}` : ''}` : 'chart …',
        live.updated ? `updated ${new Date(live.updated).toLocaleString()}` : '',
      ], [
        { label: 'Upgrade', kind: 'primary', enabled: true, run: async () => openTechTree({ upgrade: key }) },
        { label: 'Roll back', kind: 'secondary', confirm: 'Confirm roll back?', enabled: live.revision > 1, run: async () => { await helm.rollback(live.ns, live.name, 0); this.announce(`ROLLBACK ORDERED: ${live.name}`); } },
        { label: 'Weigh anchor', kind: 'danger', confirm: 'Confirm: uninstall release?', enabled: true, run: async () => { await helm.uninstall(live.ns, live.name); this.announce(`EXPANSION SOLD: ${live.name}`); selection.clear(); } },
      ]);
      return;
    }
    const pods = keys.filter((k) => k.startsWith('u:')).map((k) => store.pods.get(k.slice(2))).filter((p) => !!p);
    if (pods.length === 0) {
      card.hidden = true;
      return;
    }
    const plan = sellPlan(pods, store.deployments);
    const actions: Action[] = [
      {
        label: plan.sellable ? `Scrap ${pods.length > 1 ? `${pods.length} ships` : 'ship'}` : 'No shipyard to scrap from',
        kind: 'danger', enabled: plan.sellable,
        run: async () => {
          for (const g of plan.groups) await scaleDeployment(g.ns, g.deployment, g.target, g.names);
          this.announce(`UNIT${pods.length > 1 ? 'S' : ''} SOLD`);
          selection.clear();
        },
      },
      {
        label: `Refit ${pods.length > 1 ? `${pods.length} ships` : 'ship'}`, kind: 'secondary', enabled: true,
        run: async () => {
          for (const p of pods) await deletePod(p.ns, p.name);
          this.announce('REPAIR ORDERED');
          selection.clear();
        },
      },
    ];
    if (pods.length === 1) {
      const p = pods[0]!;
      const dep = p.deployment ? store.deployments.get(nsKey(p.ns, p.deployment)) : undefined;
      const old = !!(dep?.currentRS && p.ownerRS && p.ownerRS !== dep.currentRS);
      const variant = shipVariant(p);
      const owner = p.ownerKind && p.ownerName ? store.workloads.get(wlKey(p.ownerKind, p.ns, p.ownerName)) : undefined;
      const title = variant === 'tanker' ? `Tanker ${p.name} · hull ${hullNumber(p)}` : variant === 'tug' ? `Tugboat ${p.name}` : variant === 'boat' ? `Fishing boat ${p.name}` : `Ship ${p.name}`;
      const from = p.deployment ? `from shipyard ${p.deployment}${old ? ' (old refit)' : ''}`
        : variant === 'tanker' ? `from tanker terminal ${p.ownerName} (${owner ? `${owner.ready}/${owner.desired} moored` : '…'})`
        : variant === 'tug' ? `tug company ${p.ownerName} (${owner ? `${owner.ready}/${owner.desired} docks served` : '…'})`
        : variant === 'boat' ? `fleet ${p.ownerName} (${owner ? `${owner.ready}/${owner.desired} catches landed${owner.complete ? ', home' : ''}` : '…'})`
        : 'no shipyard (static pod)';
      // Tankers retire by hull number, tugs and fishing boats are not scrapped one by one.
      const tail = variant === 'ship' ? actions : actions.filter((a) => !/scrap/i.test(a.label));
      if (variant === 'tug' && owner) tail.push({ label: 'Disband tug company', kind: 'danger', confirm: 'Confirm: delete the DaemonSet?', enabled: true, run: async () => { await workloadApi.remove('DaemonSet', owner.ns, owner.name); selection.clear(); } });
      if (variant === 'boat' && owner) tail.push({ label: 'Recall fleet', kind: 'danger', confirm: 'Confirm: delete the Job?', enabled: true, run: async () => { await workloadApi.remove('Job', owner.ns, owner.name); selection.clear(); } });
      tail.unshift({ label: "Ship's log", kind: 'primary', enabled: true, run: async () => openLogs(p) });
      tail.push({ label: 'Papers', kind: 'secondary', enabled: true, run: async () => openPapers('Pod', p.ns, p.name) });
      tail.push({ label: 'Change ensign', kind: 'secondary', enabled: true, run: async () => openEnsignForm({ kind: 'Pod', ns: p.ns, name: p.name, labels: p.labels }) });
      this.setCard(title, [
        `${p.ns} · ${p.phase}${p.ready ? ' · ready' : ''} · ${p.restarts} restart${p.restarts === 1 ? '' : 's'}`,
        `dock ${p.node || '(not yet berthed)'} · cargo ${p.containers.join(', ') || 'none'}`,
        p.reason ? `⚠ ${p.reason}` : '',
        from,
      ], tail, namespaceColor(p.ns));
    } else {
      this.setCard(`${pods.length} ships selected`, [], actions);
    }
  }

  /** Card for a DaemonSet or Job reached through locate. */
  private workloadCard(w: Workload): void {
    if (w.kind === 'DaemonSet') {
      this.setCard(`Tug company ${w.name}`, [`${w.ns} · ${w.image} · DaemonSet`, `${w.ready}/${w.desired} docks served (one tug per dock)`], [
        { label: 'Disband', kind: 'danger', confirm: 'Confirm: delete the DaemonSet?', enabled: true, run: async () => { await workloadApi.remove('DaemonSet', w.ns, w.name); selection.clear(); } },
      ], namespaceColor(w.ns));
    } else {
      this.setCard(`Fishing fleet ${w.name}`, [
        `${w.ns} · ${w.image} · Job${w.complete ? ' · home' : ' · at sea'}`,
        `${w.ready}/${w.desired} catches landed · ${w.active ?? 0} at sea · ${w.failed ?? 0} lost`,
      ], [
        { label: 'Recall fleet', kind: 'danger', confirm: 'Confirm: delete the Job?', enabled: true, run: async () => { await workloadApi.remove('Job', w.ns, w.name); selection.clear(); } },
      ], namespaceColor(w.ns));
    }
  }

  // ---- store feed --------------------------------------------------------

  private onStore(e: StoreEvent): void {
    for (const line of this.feed.announce(e)) this.announce(line);
    if (e.type === 'snapshot' || e.type === 'node' || e.type === 'pod' || e.type === 'namespace') this.refreshStatus();
    if (e.type === 'workload' && e.op === 'delete') selection.clear();
    if (e.type === 'event' && e.event.type === 'Warning') this.map.flashFor(e.event);
    if (e.type === 'release') this.relDetails.delete(e.key);
    this.refreshSelection();
  }
}

function splitNs(key: string): [string, string] {
  const i = key.indexOf('/');
  return [key.slice(0, i), key.slice(i + 1)];
}

/** Opens one of the HUD's own overlays (log, settings) with the shared modal flag. */
function openOverlayHere(id: string): () => void {
  const root = document.getElementById(id)!;
  const onEscape = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') close();
  };
  const close = (): void => {
    root.hidden = true;
    window.removeEventListener('keydown', onEscape, true);
    modal.set(false);
  };
  root.hidden = false;
  modal.set(true);
  window.addEventListener('keydown', onEscape, true);
  return close;
}

/** Rewords the RTS-era EVA lines into harbor speak for toasts. */
export function navalise(line: string): string {
  return line
    .replace(/^BATTLEFIELD CONTROL ESTABLISHED/, 'Harbor master online')
    .replace(/^CONSTRUCTION STARTED: (.*)/, 'Shipyard laid down: $1')
    .replace(/^NEW CONSTRUCTION: (.*)/, 'New shipyard: $1')
    .replace(/^CONSTRUCTION COMPLETE: (.*)/, 'Shipyard operational: $1')
    .replace(/^UNIT DEPLOYED: (.*)/, 'Ship launched: $1')
    .replace(/^UNIT ORDERED: (.*)/, 'Keel laid at $1')
    .replace(/^UNIT RETIRED: (.*)/, 'Ship scrapped at $1')
    .replace(/^UNIT LOST: (.*)/, 'Ship sunk: $1')
    .replace(/^UNITS? SOLD/, 'Ships scrapped')
    .replace(/^REPAIR ORDERED/, 'Refit ordered')
    .replace(/^STRUCTURE SOLD: (.*)/, 'Shipyard sold: $1')
    .replace(/^STRUCTURE RELOCATED: (.*)/, 'Shipyard moved: $1')
    .replace(/^BASE EXPANSION: (.*)/, 'New anchorage: $1')
    .replace(/^EXPANSION ORDERED: (.*)/, 'Anchorage ordered: $1')
    .replace(/^EXPANSION ONLINE: (.*)/, 'Anchorage ready: $1')
    .replace(/^EXPANSION FAILED: (.*)/, 'Anchorage failed: $1')
    .replace(/^EXPANSION DISMANTLED: (.*)/, 'Anchorage cleared: $1')
    .replace(/^EXPANSION SOLD: (.*)/, 'Anchor weighed: $1')
    .replace(/^UPGRADE ORDERED: (.*)/, 'Upgrade ordered: $1')
    .replace(/^ROLLBACK ORDERED: (.*)/, 'Roll back ordered: $1')
    .replace(/^TECH UNLOCKED: (.*)/, 'Chart library added: $1')
    .replace(/^TECH TREE UPDATED/, 'Chart libraries refreshed')
    .replace(/^THEATER CHANGED: (.*)/, 'Sailed to harbor $1')
    .replace(/^GATE OPENED: (.*)/, 'Gate opened at the harbor mouth: $1')
    .replace(/^GATE CLOSED: (.*)/, 'Gate closed: $1')
    .replace(/^FLEET SAILED: (.*)/, 'Fishing fleet sailed: $1')
    .replace(/^FLEET RECALLED: (.*)/, 'Fleet recalled: $1')
    .replace(/^CATCH LANDED: (.*)/, 'Catch landed: $1')
    .replace(/^CATCH LOST: (.*)/, 'Catch lost: $1')
    .replace(/^UNABLE TO COMPLY: (.*)/, 'Unable to comply: $1')
    .replace(/^CANNOT DEPLOY HERE/, 'Cannot build there')
    .replace(/^LINK TO BACKEND LOST/, 'Lost contact with the harbor master')
    .replace(/^INSUFFICIENT POWER/, 'Berths nearly full')
    .replace(/^LOW POWER/, 'Berths filling up');
}
