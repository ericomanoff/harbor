import type { Level } from '../types';
import { level1 } from './level1';
import { level2 } from './level2';
import { level3 } from './level3';
import { level4 } from './level4';
import { level5 } from './level5';
import { level6 } from './level6';
import { level7 } from './level7';
import { level8 } from './level8';
import { level9 } from './level9';
import { level10 } from './level10';

/** Advanced K8s: the hands-on levels, in order; each names the principle it practises. */
export const ADVANCED: Level[] = [level1, level2, level3, level4, level5, level6, level7, level8, level9, level10];

export const levelById = (id: string): Level | undefined => ADVANCED.find((l) => l.id === id);
export const nextLevel = (id: string): Level | undefined => ADVANCED[ADVANCED.findIndex((l) => l.id === id) + 1];
