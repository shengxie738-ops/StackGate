/**
 * Package entry for the Playwright adapter. `scripts/build.mjs` bundles this file into
 * `dist/playwright-reporter.mjs`, and a Playwright config resolves the reporter from the module's
 * default export, so the default binding is part of the public contract, not a convenience.
 */
export { default, default as StackGateReporter } from './reporter.js';
export {
  assertNoCompletedReport,
  atomicWriteJson,
  reporterIdentity,
  stableTestId,
  STACKGATE_ID_ANNOTATION,
  UNANNOTATED_TEST_ID,
} from './inventory.js';
