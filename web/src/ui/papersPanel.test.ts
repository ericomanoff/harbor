import { describe, expect, it } from 'vitest';
import { disagreements } from './papersPanel';

describe('disagreements', () => {
  it('flags status lines that lag the spec', () => {
    const bad = disagreements('replicas: 3\nimage: x', 'replicas: 3\navailableReplicas: 2\nreadyReplicas: 3\nobservedGeneration: 4');
    expect([...bad]).toEqual(['availableReplicas: 2']);
  });
});
