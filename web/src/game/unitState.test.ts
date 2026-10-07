import { describe, expect, it } from 'vitest';
import type { Deployment, Pod } from '../store/cluster';
import { isObsolete, unitState } from './unitState';

const pod = (over: Partial<Pod> = {}): Pod => ({ ns: 'a', name: 'p', node: 'n1', phase: 'Running', ready: true, restarts: 0, created: 'x', ...over });

describe('unitState', () => {
  it('maps phases and reasons to states', () => {
    expect(unitState(pod())).toBe('ok');
    expect(unitState(pod({ ready: false }))).toBe('notready');
    expect(unitState(pod({ phase: 'Pending', ready: false, node: '' }))).toBe('pending');
    expect(unitState(pod({ node: '' }))).toBe('pending');
    expect(unitState(pod({ reason: 'CrashLoopBackOff', ready: false }))).toBe('crash');
    expect(unitState(pod({ reason: 'ImagePullBackOff' }))).toBe('crash');
    expect(unitState(pod({ reason: 'ErrImagePull' }))).toBe('crash');
    expect(unitState(pod({ reason: 'OOMKilled' }))).toBe('crash');
    expect(unitState(pod({ phase: 'Failed', reason: 'Evicted' }))).toBe('done');
    expect(unitState(pod({ phase: 'Terminating' }))).toBe('terminating');
    expect(unitState(pod({ phase: 'Succeeded' }))).toBe('done');
  });
  it('crash wins over pending so a crashing Pending pod still burns', () => {
    expect(unitState(pod({ phase: 'Pending', reason: 'ImagePullBackOff' }))).toBe('crash');
  });
});

describe('isObsolete', () => {
  const dep: Deployment = { ns: 'a', name: 'd', replicas: 1, available: 1, updated: 1, image: 'x', conditions: [], currentRS: 'd-new' };
  it('flags pods owned by an old ReplicaSet', () => {
    expect(isObsolete(pod({ ownerRS: 'd-old' }), dep)).toBe(true);
    expect(isObsolete(pod({ ownerRS: 'd-new' }), dep)).toBe(false);
    expect(isObsolete(pod(), dep)).toBe(false);
    expect(isObsolete(pod({ ownerRS: 'd-old' }), { ...dep, currentRS: undefined })).toBe(false);
    expect(isObsolete(pod({ ownerRS: 'd-old' }), undefined)).toBe(false);
  });
});
