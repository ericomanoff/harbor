import { describe, expect, it, vi } from 'vitest';
import { ApiError, createDeployment, deleteDeployment, deletePod, formatHealth, getHealth, scaleDeployment, setMapPos } from './client';

const fakeFetch = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('getHealth', () => {
  it('returns the decoded health object', async () => {
    const f = fakeFetch(200, { status: 'ok', version: '0.1.0', uptimeSeconds: 7 });
    await expect(getHealth(f)).resolves.toEqual({ status: 'ok', version: '0.1.0', uptimeSeconds: 7 });
  });

  it('throws an ApiError with the backend message', async () => {
    const f = fakeFetch(503, { message: 'nope' });
    await expect(getHealth(f)).rejects.toMatchObject({ status: 503, message: 'nope' });
    await expect(getHealth(f)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('formatHealth', () => {
  it('renders a sidebar-style status line', () => {
    expect(formatHealth({ status: 'ok', version: 'dev', uptimeSeconds: 3 })).toBe('BACKEND ONLINE  vdev  UP 3s');
  });
});

describe('actions', () => {
  it('posts a create request as JSON', async () => {
    const f = fakeFetch(201, { ns: 'a', name: 'web', replicas: 1, available: 0, updated: 0, image: 'x', conditions: [] });
    const d = await createDeployment({ ns: 'a', name: 'web', image: 'x', replicas: 1 }, f);
    expect(d.name).toBe('web');
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/deployments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ ns: 'a', name: 'web', image: 'x', replicas: 1 });
  });

  it('scales with retireFirst only when given, and encodes path parts', async () => {
    const f = fakeFetch(204);
    await scaleDeployment('my ns', 'web', 2, ['web-1'], f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/deployments/my%20ns/web/scale');
    expect(JSON.parse(init.body as string)).toEqual({ replicas: 2, retireFirst: ['web-1'] });
    await scaleDeployment('a', 'web', 3, [], f);
    const [, init2] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init2.body as string)).toEqual({ replicas: 3 });
  });

  it('deletes deployments and pods with no body', async () => {
    const f = fakeFetch(204);
    await deleteDeployment('a', 'web', f);
    await deletePod('a', 'web-1', f);
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    expect(calls[0]?.[0]).toBe('/api/deployments/a/web');
    expect(calls[0]?.[1].method).toBe('DELETE');
    expect(calls[0]?.[1].body).toBeUndefined();
    expect(calls[1]?.[0]).toBe('/api/pods/a/web-1');
  });

  it('patches the map position', async () => {
    const f = fakeFetch(204);
    await setMapPos('a', 'web', { x: 1, y: 2 }, f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/deployments/a/web/mappos');
    expect(init.method).toBe('PATCH');
  });
});
