import { helm, type HelmChart, type HelmRelease, type HelmRevision } from '../api/client';
import { eva, store } from '../app';
import { nsOptions, openOverlay } from './overlay';

export type TechTab = 'charts' | 'repos' | 'releases';

export interface TechOptions {
  tab?: TechTab;
  /** "ns/name": jump straight to the upgrade form for this release. */
  upgrade?: string;
}

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`tech tree: missing ${sel}`);
  return el;
};

const el = (tag: string, text?: string, cls?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

const button = (label: string, onClick: () => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.onclick = onClick;
  return b;
};

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The Helm tech tree: charts to build, repositories to unlock, releases to manage. */
export function openTechTree(opts: TechOptions = {}): void {
  const root = $<HTMLDivElement>(document, '#tech');
  const err = $<HTMLParagraphElement>(root, '.err');
  const panes: Record<string, HTMLElement> = {};
  root.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => { panes[p.dataset['pane']!] = p; });
  const tabs = root.querySelectorAll<HTMLButtonElement>('[data-tab]');
  const close = openOverlay('tech');
  $<HTMLButtonElement>(root, 'button[data-close]').onclick = close;

  const fail = (e: unknown): void => {
    err.textContent = `UNABLE TO COMPLY: ${errMsg(e)}`;
    err.hidden = false;
  };
  const show = (pane: string): void => {
    err.hidden = true;
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== pane;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset['tab'] === pane));
  };
  tabs.forEach((t) => { t.onclick = () => { show(t.dataset['tab']!); void refresh(t.dataset['tab'] as TechTab); }; });

  // ---- charts -----------------------------------------------------------
  const q = $<HTMLInputElement>(panes['charts']!, 'input[name=q]');
  const chartRows = $<HTMLDivElement>(panes['charts']!, '.rows');
  const renderCharts = async (): Promise<void> => {
    try {
      const charts = await helm.searchCharts(q.value);
      chartRows.replaceChildren(...(charts.length ? charts.map(chartRow) : [el('p', 'No charts. Add a repository under REPOS.', 'muted')]));
    } catch (e) { fail(e); }
  };
  const chartRow = (c: HelmChart): HTMLElement => {
    const row = el('div', undefined, 'row');
    row.append(el('b', `${c.repo}/${c.name}`), el('span', `${c.version}${c.appVersion ? `  app ${c.appVersion}` : ''}`, 'muted'), el('span', c.description, 'desc'));
    row.append(button('BUILD', () => void openInstall(c)));
    return row;
  };
  q.oninput = () => void renderCharts();

  // ---- repos ------------------------------------------------------------
  const repoRows = $<HTMLDivElement>(panes['repos']!, '.rows');
  const rname = $<HTMLInputElement>(panes['repos']!, 'input[name=rname]');
  const rurl = $<HTMLInputElement>(panes['repos']!, 'input[name=rurl]');
  const renderRepos = async (): Promise<void> => {
    try {
      const repos = await helm.listRepos();
      repoRows.replaceChildren(...(repos.length ? repos.map((r) => {
        const row = el('div', undefined, 'row');
        row.append(el('b', r.name), el('span', r.url, 'desc'));
        return row;
      }) : [el('p', 'No repositories yet. Try podinfo: https://stefanprodan.github.io/podinfo', 'muted')]));
    } catch (e) { fail(e); }
  };
  $<HTMLButtonElement>(panes['repos']!, 'button[data-add]').onclick = async () => {
    try {
      await helm.addRepo({ name: rname.value.trim(), url: rurl.value.trim() });
      eva.emit(`TECH UNLOCKED: ${rname.value.trim()}`);
      rname.value = '';
      rurl.value = '';
      await renderRepos();
    } catch (e) { fail(e); }
  };
  $<HTMLButtonElement>(panes['repos']!, 'button[data-update]').onclick = async () => {
    try {
      await helm.updateRepos();
      eva.emit('TECH TREE UPDATED');
      await renderRepos();
    } catch (e) { fail(e); }
  };

  // ---- releases ---------------------------------------------------------
  const relRows = $<HTMLDivElement>(panes['releases']!, '.rows');
  const renderReleases = async (): Promise<void> => {
    try {
      const rels = await helm.listReleases();
      relRows.replaceChildren(...(rels.length ? rels.map(releaseRow) : [el('p', 'No base expansions deployed.', 'muted')]));
    } catch (e) { fail(e); }
  };
  const releaseRow = (r: HelmRelease): HTMLElement => {
    const row = el('div', undefined, 'row');
    row.append(el('b', `${r.ns}/${r.name}`), el('span', `${r.chart ?? '?'}-${r.chartVersion ?? '?'}  rev ${r.revision}`, 'muted'), el('span', r.status, `status ${r.status}`));
    row.append(button('UPGRADE', () => void openUpgrade(r)));
    const rb = button('ROLLBACK', async () => {
      try {
        const hist = await helm.history(r.ns, r.name);
        const picker = el('div', undefined, 'picker');
        picker.append(el('span', 'to revision:', 'muted'));
        for (const h of hist.filter((h: HelmRevision) => h.revision !== r.revision)) {
          picker.append(button(`r${h.revision} ${h.chart} (${h.status})`, async () => {
            try {
              await helm.rollback(r.ns, r.name, h.revision);
              eva.emit(`ROLLBACK ORDERED: ${r.name} to r${h.revision}`);
              await renderReleases();
            } catch (e) { fail(e); }
          }));
        }
        if (hist.length < 2) picker.append(el('span', 'no earlier revision', 'muted'));
        row.after(picker);
        rb.disabled = true;
      } catch (e) { fail(e); }
    });
    row.append(rb);
    const un = button('UNINSTALL', async () => {
      if (un.dataset['armed'] !== '1') {
        un.dataset['armed'] = '1';
        un.textContent = 'CONFIRM?';
        setTimeout(() => { un.dataset['armed'] = ''; un.textContent = 'UNINSTALL'; }, 4000);
        return;
      }
      try {
        await helm.uninstall(r.ns, r.name);
        eva.emit(`EXPANSION SOLD: ${r.name}`);
        await renderReleases();
      } catch (e) { fail(e); }
    });
    row.append(un);
    return row;
  };

  // ---- install / upgrade form -------------------------------------------
  const form = $<HTMLFormElement>(panes['form']!, 'form');
  const f = {
    title: $<HTMLElement>(panes['form']!, 'h3'),
    chart: $<HTMLInputElement>(form, 'input[name=chart]'),
    name: $<HTMLInputElement>(form, 'input[name=name]'),
    ns: $<HTMLSelectElement>(form, 'select[name=ns]'),
    version: $<HTMLInputElement>(form, 'input[name=version]'),
    values: $<HTMLTextAreaElement>(form, 'textarea[name=values]'),
    submit: $<HTMLButtonElement>(form, 'button[type=submit]'),
    back: $<HTMLButtonElement>(form, 'button[data-back]'),
  };
  let backTo: TechTab = 'charts';
  f.back.onclick = () => { show(backTo); void refresh(backTo); };

  const loadValues = async (chart: string, version: string): Promise<void> => {
    f.values.value = '# loading defaults…';
    try {
      const v = await helm.chartValues(chart, version || undefined);
      f.values.value = v.values;
      if (!f.version.value) f.version.value = v.version;
    } catch (e) {
      f.values.value = '';
      fail(e);
    }
  };

  const openInstall = async (c: HelmChart): Promise<void> => {
    backTo = 'charts';
    f.title.textContent = 'BUILD BASE EXPANSION';
    f.chart.value = `${c.repo}/${c.name}`;
    f.chart.readOnly = true;
    f.name.value = c.name;
    f.name.readOnly = false;
    f.ns.replaceChildren(...nsOptions(store).map((ns) => Object.assign(document.createElement('option'), { value: ns, textContent: ns })));
    f.ns.disabled = false;
    f.version.value = c.version;
    f.submit.textContent = 'DEPLOY';
    show('form');
    await loadValues(f.chart.value, c.version);
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      f.submit.disabled = true;
      try {
        await helm.install({ ns: f.ns.value, name: f.name.value.trim(), chart: f.chart.value, version: f.version.value.trim() || undefined, values: f.values.value });
        eva.emit(`EXPANSION ORDERED: ${f.name.value.trim()}`);
        close();
      } catch (e) { fail(e); } finally { f.submit.disabled = false; }
    };
  };

  const openUpgrade = async (r: HelmRelease): Promise<void> => {
    backTo = 'releases';
    f.title.textContent = `UPGRADE ${r.ns}/${r.name}`;
    f.chart.value = r.chart ? await guessChartRef(r.chart) : '';
    f.chart.readOnly = false;
    f.name.value = r.name;
    f.name.readOnly = true;
    f.ns.replaceChildren(Object.assign(document.createElement('option'), { value: r.ns, textContent: r.ns }));
    f.ns.disabled = true;
    f.version.value = '';
    f.submit.textContent = 'UPGRADE';
    show('form');
    f.values.value = '# Overrides for the new revision (chart defaults apply underneath).';
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      f.submit.disabled = true;
      try {
        await helm.upgrade(r.ns, r.name, { chart: f.chart.value.trim() || undefined, version: f.version.value.trim() || undefined, values: f.values.value });
        eva.emit(`UPGRADE ORDERED: ${r.name}`);
        close();
      } catch (e) { fail(e); } finally { f.submit.disabled = false; }
    };
  };

  /** A release only knows its chart name; find which repo offers it. */
  const guessChartRef = async (chartName: string): Promise<string> => {
    try {
      const hit = (await helm.searchCharts(chartName)).find((c) => c.name === chartName);
      return hit ? `${hit.repo}/${hit.name}` : chartName;
    } catch {
      return chartName;
    }
  };

  const refresh = async (tab: TechTab): Promise<void> => {
    if (tab === 'charts') await renderCharts();
    else if (tab === 'repos') await renderRepos();
    else await renderReleases();
  };

  if (opts.upgrade) {
    const r = store.releases.get(opts.upgrade);
    if (r) {
      void helm.listReleases().then((rels) => openUpgrade(rels.find((x) => `${x.ns}/${x.name}` === opts.upgrade) ?? r)).catch(fail);
      return;
    }
  }
  const tab = opts.tab ?? 'charts';
  show(tab);
  void refresh(tab);
  if (tab === 'charts') q.focus();
}
