import { describe, expect, it } from 'vitest';
import { parseOrders } from './ordersForm';

describe('parseOrders', () => {
  it('reads KEY=value lines, keeps = inside values, skips junk', () => {
    expect(parseOrders('PORT=8443\n  URL = https://a/b?x=1 \n\nnoequals\n=novalue')).toEqual({ PORT: '8443', URL: 'https://a/b?x=1' });
  });
});
