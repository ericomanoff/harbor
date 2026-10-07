import { describe, expect, it } from 'vitest';
import { formatHealth, getHealth } from './client';

describe('getHealth', () => {
  it('returns the decoded health object', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ status: 'ok', version: '0.1.0', uptimeSeconds: 7 }), {
        status: 200,
      })) as unknown as typeof fetch;
    await expect(getHealth(fake)).resolves.toEqual({ status: 'ok', version: '0.1.0', uptimeSeconds: 7 });
  });

  it('throws on a non-2xx response', async () => {
    const fake = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(getHealth(fake)).rejects.toThrow('HTTP 503');
  });
});

describe('formatHealth', () => {
  it('renders a sidebar-style status line', () => {
    expect(formatHealth({ status: 'ok', version: 'dev', uptimeSeconds: 3 })).toBe(
      'BACKEND ONLINE  vdev  UP 3s',
    );
  });
});
