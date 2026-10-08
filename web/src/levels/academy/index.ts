import type { Level } from '../types';
import { level1 } from './level1';
import { level2 } from './level2';

/** The beginner campaign, in order. */
export const ACADEMY: Level[] = [level1, level2];

export const levelById = (id: string): Level | undefined => ACADEMY.find((l) => l.id === id);
export const nextLevel = (id: string): Level | undefined => ACADEMY[ACADEMY.findIndex((l) => l.id === id) + 1];
