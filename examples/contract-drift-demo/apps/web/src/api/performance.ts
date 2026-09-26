/**
 * Legacy consumer of the performance endpoint.
 *
 * It reads `data.totalReturn`, which is the pre-rename shape. The FastAPI service answers with
 * `data.performance.total_return`, so this module is the injected fault for the demo; the reviewed
 * fix patch in ../../patches changes the reader below and nothing else about the acceptance goal.
 */
export interface PerformanceSummary {
  totalReturn: number | null;
  period: string | null;
}

export class PerformanceDataError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'PerformanceDataError';
  }
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PerformanceDataError(field, `Expected a finite number at ${field}, received ${JSON.stringify(value) ?? typeof value}`);
  }
  return value;
}

export async function fetchPerformance(fetchImpl: typeof fetch, apiOrigin: string): Promise<PerformanceSummary> {
  const response = await fetchImpl(`${apiOrigin}/api/performance`, { method: 'GET', headers: { accept: 'application/json' } });
  if (!response.ok) throw new PerformanceDataError('status', `Performance request failed with status ${response.status}`);
  const payload: unknown = await response.json();
  const data = (payload as { data?: unknown } | null)?.data as
    | { totalReturn?: unknown; performance?: { total_return?: unknown; period?: unknown } }
    | undefined;
  if (data === undefined) throw new PerformanceDataError('data', 'Response is missing the data object');
  const legacy = data.totalReturn;
  if (legacy === null) return { totalReturn: null, period: null };
  const totalReturn = requireFiniteNumber(legacy, 'data.totalReturn');
  if (!Number.isFinite(totalReturn)) {
    throw new PerformanceDataError('data.totalReturn', 'Response is missing the legacy field data.totalReturn');
  }
  return { totalReturn, period: typeof data.performance?.period === 'string' ? data.performance.period : null };
}
