import { useEffect, useState } from 'react';
import { fetchPerformance, PerformanceDataError, type PerformanceSummary } from '../api/performance.js';

type State =
  | { phase: 'loading' }
  | { phase: 'empty' }
  | { phase: 'ready'; summary: PerformanceSummary }
  | { phase: 'error'; message: string };

export function formatTotalReturn(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export interface PerformancePageProps {
  fetchImpl: typeof fetch;
  apiOrigin?: string;
}

export function PerformancePage({ fetchImpl, apiOrigin = import.meta.env.STACKGATE_API_ORIGIN }: PerformancePageProps) {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ phase: 'loading' });
    fetchPerformance(fetchImpl, apiOrigin)
      .then(summary => {
        if (!active) return;
        setState(summary.totalReturn === null ? { phase: 'empty' } : { phase: 'ready', summary });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof PerformanceDataError || error instanceof Error ? error.message : 'Unknown performance error';
        setState({ phase: 'error', message });
      });
    return () => { active = false; };
  }, [fetchImpl, apiOrigin]);

  return (
    <main>
      <h1>Portfolio performance</h1>
      <div data-testid="performance-summary">
        {state.phase === 'loading' && <span data-testid="performance-loading">Loading</span>}
        {state.phase === 'empty' && <span data-testid="performance-empty">No performance data</span>}
        {state.phase === 'error' && <span data-testid="performance-error">{state.message}</span>}
        {state.phase === 'ready' && (
          <span data-testid="total-return">{formatTotalReturn(state.summary.totalReturn as number)}</span>
        )}
      </div>
    </main>
  );
}
