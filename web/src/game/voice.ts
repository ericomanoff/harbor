/**
 * Maps EVA log lines to the short spoken lines of a base computer. Only a
 * fixed set exists on purpose: EVA never reads pod names aloud.
 */
const LINES: [RegExp, string][] = [
  [/^BATTLEFIELD CONTROL/, 'Battlefield control established'],
  [/^CONSTRUCTION COMPLETE/, 'Construction complete'],
  [/^CONSTRUCTION STARTED|^NEW CONSTRUCTION/, 'Building'],
  [/^UNIT DEPLOYED/, 'Unit ready'],
  [/^UNIT ORDERED/, 'Training'],
  [/^UNIT LOST/, 'Unit lost'],
  [/^UNITS? SOLD|^UNIT RETIRED/, 'Unit sold'],
  [/^STRUCTURE SOLD|^EXPANSION DISMANTLED/, 'Structure sold'],
  [/^BASE EXPANSION|^EXPANSION ORDERED/, 'Building'],
  [/^EXPANSION ONLINE/, 'Base expansion complete'],
  [/^EXPANSION FAILED/, 'Base expansion failed'],
  [/^STRUCTURE RELOCATED/, 'Structure relocated'],
  [/^REPAIR ORDERED/, 'Repairing'],
  [/^UNABLE TO COMPLY/, 'Unable to comply'],
  [/^CANNOT DEPLOY HERE/, 'Cannot deploy here'],
  [/^LINK TO BACKEND LOST/, 'Communications lost'],
  [/^INSUFFICIENT POWER/, 'Insufficient power'],
  [/^LOW POWER/, 'Low power'],
  [/BackOff|CrashLoop|OOM|Failed|Unhealthy|Evicted/i, 'Unit under attack'],
];

export function voiceLineFor(evaLine: string): string | undefined {
  for (const [re, line] of LINES) if (re.test(evaLine)) return line;
  return undefined;
}
