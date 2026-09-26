import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PerformancePage, formatTotalReturn } from '../src/pages/PerformancePage.js';

/**
 * Fixtures for the application's own unit tests. Browser acceptance (T01/T02) must never use these;
 * it reads the running FastAPI service instead. `legacy-mock` matches the pre-rename shape the
 * unpatched consumer reads, `target-response` matches what the service actually returns today.
 */
const fixtures = {
  'legacy-mock': { data: { totalReturn: 0.1234 } },
  'target-response': { data: { performance: { total_return: 0.1234, period: '2026-Q3' } } },
} as const;

const selected = (process.env.STACKGATE_DEMO_FIXTURE ?? 'legacy-mock') as keyof typeof fixtures;
if (!(selected in fixtures)) throw new Error(`Unknown demo fixture ${String(selected)}`);

function stubFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

const origin = 'http://127.0.0.1:8000';
afterEach(cleanup);

it('displays the confirmed acceptance value 12.34%', async () => {
  render(<PerformancePage fetchImpl={stubFetch(fixtures[selected])} apiOrigin={origin} />);
  const summary = await screen.findByTestId('total-return', {}, { timeout: 2000 });
  expect(summary.textContent).toBe('12.34%');
});

it('reports an explicit error instead of coercing a non-numeric return', async () => {
  render(<PerformancePage fetchImpl={stubFetch({ data: { totalReturn: '0.1234' } })} apiOrigin={origin} />);
  const error = await screen.findByTestId('performance-error', {}, { timeout: 2000 });
  expect(error.textContent).toContain('finite number');
  expect(screen.queryByTestId('total-return')).toBeNull();
});

it('keeps a declared null payload as an empty state rather than zero percent', async () => {
  render(<PerformancePage fetchImpl={stubFetch({ data: { totalReturn: null } })} apiOrigin={origin} />);
  const empty = await screen.findByTestId('performance-empty', {}, { timeout: 2000 });
  expect(empty.textContent).toBe('No performance data');
});

it('surfaces a transport failure as an error state', async () => {
  render(<PerformancePage fetchImpl={stubFetch({ detail: 'not found' }, 404)} apiOrigin={origin} />);
  const error = await screen.findByTestId('performance-error', {}, { timeout: 2000 });
  expect(error.textContent).toContain('404');
});

it('formats returns without inventing precision', () => {
  expect(formatTotalReturn(0.1234)).toBe('12.34%');
  expect(formatTotalReturn(0)).toBe('0.00%');
  expect(formatTotalReturn(-0.075)).toBe('-7.50%');
});
