import type { Diagnostic, RunEvent } from '../../../contracts/src/index.js';
export interface EventReduction { status: 'VALID' | 'ERROR'; run_id: string | null; next_seq: number; events: RunEvent[]; diagnostics: Diagnostic[] }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value);
}
/** Consumes already schema-validated events; no clocks, filesystem or Gate decisions. */
export function reduceEvents(incoming: readonly RunEvent[]): EventReduction {
  const events: RunEvent[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, string>();
  let runId: string | null = null;
  let nextSeq = 1;
  for (const event of incoming) {
    const serialized = canonical(event);
    const previous = seen.get(event.event_id);
    if (previous === serialized) continue;
    let reason: string | null = null;
    if (previous !== undefined) reason = 'Duplicate event_id contains conflicting facts';
    else if (runId !== null && runId !== event.run_id) reason = 'Event belongs to a different run';
    else if (!Number.isSafeInteger(event.seq) || event.seq !== nextSeq) reason = 'Event sequence must start at one and advance without gaps';
    if (reason) {
      diagnostics.push({ code: 'REPORT_INVALID', rule_id: 'SG-EVIDENCE-EVENT_SEQUENCE', message: reason, location: `/events/${event.event_id}`, observed_facts: { event_id: event.event_id, received_seq: event.seq, expected_seq: nextSeq, run_id: event.run_id }, recommended_action: 'Preserve the original event log and reject this inconsistent stream.', source: 'event-reducer' });
      continue;
    }
    runId = event.run_id;
    seen.set(event.event_id, serialized);
    events.push(event);
    nextSeq++;
  }
  return { status: diagnostics.length ? 'ERROR' : 'VALID', run_id: runId, next_seq: nextSeq, events, diagnostics };
}
