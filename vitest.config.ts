import { defineConfig } from 'vitest/config';
// Integration suites each start real git repositories, CLI children and business processes and fsync evidence
// onto one volume. At the default worker count (cores-1) every case ran ~2.5x slower and the heavy
// authentication tests crossed their budgets, so scheduling is capped instead of raising those budgets.
// This is harness scheduling only: product command timeouts stay exactly as configured.
// Vitest 4 removed test.poolOptions, so maxWorkers must stay top-level here.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], passWithNoTests: false, testTimeout: 15000, pool: 'forks', maxWorkers: 2 } });
