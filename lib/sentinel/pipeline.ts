// Stage runner for the hourly refresh (`pipeline-v1`). Pure: no database, no network.
// It times each stage, maps whatever the stage returned onto one status vocabulary,
// and never lets one stage's failure stop another. A failure is never reported as complete.

export const STAGES = ['filings', 'news', 'discovery', 'assessment', 'outcomes', 'practice', 'experiment'] as const;
export type Stage = (typeof STAGES)[number];
export type StageStatus = 'complete' | 'partial' | 'idle' | 'failed' | 'skipped';
export type StageRecord = { stage: Stage; status: StageStatus; elapsedMs: number; message?: string };
export type PipelineSummary = { status: 'complete' | 'partial' | 'failed' | 'idle'; failed: Stage[]; partial: Stage[]; skipped: Stage[] };

/** Parse the optional `stages` argument. Absent means every stage, in the original order. */
export function parseStages(input: unknown): { stages: Stage[] } | { error: string } {
  if (input === undefined || input === null) return { stages: [...STAGES] };
  if (!Array.isArray(input) || input.length === 0) return { error: 'stages must be a non-empty list of stage names.' };
  const wanted = new Set<string>();
  for (const s of input) {
    if (typeof s !== 'string' || !(STAGES as readonly string[]).includes(s)) return { error: `Unknown stage: ${String(s).slice(0, 40)}.` };
    wanted.add(s);
  }
  // Fixed order regardless of the order requested, so a stage never runs before the one it reads from.
  return { stages: STAGES.filter(s => wanted.has(s)) };
}

/** Map a stage's own result onto one status. Unrecognised shapes are not assumed complete. */
export function statusOf(stage: Stage, result: any): StageStatus {
  if (!result || typeof result !== 'object') return 'failed';
  if (stage === 'filings' || stage === 'news') {
    const rows: any[] = Array.isArray(result.results) ? result.results : [];
    if (!rows.length) return 'idle';
    const failed = rows.filter(r => r.status === 'failed').length;
    if (failed === rows.length) return 'failed';
    // `deferred` = companies left for the next run because the stage's time budget ran out.
    return failed === 0 && !(result.deferred > 0) ? 'complete' : 'partial';
  }
  switch (result.status) {
    case 'failed': return 'failed';
    case 'partial': return 'partial';
    case 'idle': case 'not_started': return 'idle';
    case 'complete': return 'complete';
    default:
      // The Practice mark returns a dated record with no status field; any other shape is unknown, not a pass.
      return stage === 'practice' && typeof result.date === 'string' ? 'complete' : 'failed';
  }
}

function messageOf(result: any): string | undefined {
  const m = result && typeof result === 'object' ? result.message : undefined;
  return typeof m === 'string' ? m.slice(0, 200) : undefined;
}

/** Run one stage. Exceptions become a `failed` record; the caller always gets a result to continue with. */
export async function runStage(stage: Stage, fn: () => Promise<any>, now: () => number = Date.now): Promise<{ record: StageRecord; result: any }> {
  const started = now();
  try {
    const result = await fn();
    return { record: { stage, status: statusOf(stage, result), elapsedMs: now() - started, message: messageOf(result) }, result };
  } catch (e) {
    const message = (e instanceof Error ? e.message : 'Stage failed').slice(0, 200);
    return { record: { stage, status: 'failed', elapsedMs: now() - started, message }, result: { status: 'failed', message } };
  }
}

export function skippedRecord(stage: Stage): StageRecord {
  return { stage, status: 'skipped', elapsedMs: 0, message: 'Not requested in this run.' };
}

/** One honest overall status. Any failed stage means the run is not complete; partial is not a failure. */
export function summarise(records: StageRecord[]): PipelineSummary {
  const failed = records.filter(r => r.status === 'failed').map(r => r.stage);
  const partial = records.filter(r => r.status === 'partial').map(r => r.stage);
  const skipped = records.filter(r => r.status === 'skipped').map(r => r.stage);
  const ran = records.filter(r => r.status !== 'skipped');
  const status = failed.length ? (failed.length === ran.length ? 'failed' : 'partial')
    : partial.length ? 'partial'
    : ran.length && ran.every(r => r.status === 'idle') ? 'idle' : 'complete';
  return { status, failed, partial, skipped };
}
