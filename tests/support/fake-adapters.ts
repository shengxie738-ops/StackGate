import type { AdapterCapabilities, CheckResult, CheckStep, Diagnostic, RunEvent } from '../../packages/contracts/src/index.js';
import type { Adapter } from '../../packages/core/src/ports/adapter.js';
/** Explicitly test-only: the production boundary checker rejects importing this module. */
export class FakeAdapter implements Adapter {
  constructor(private readonly capabilities: AdapterCapabilities, private readonly emitted: readonly RunEvent[], private readonly steps: readonly CheckStep[] = [], private readonly result: CheckResult | null = null) {}
  describe(): AdapterCapabilities { return structuredClone(this.capabilities); }
  async validate(): Promise<Diagnostic[]> { return []; }
  async plan(): Promise<CheckStep[]> { return structuredClone([...this.steps]); }
  async *execute(): AsyncIterable<RunEvent> { for (const event of this.emitted) yield structuredClone(event); }
  events(): AsyncIterable<RunEvent> { return this.execute(); }
  async collect(): Promise<CheckResult> {
    if (this.result === null) throw new Error('FakeAdapter requires an explicit test result');
    return structuredClone(this.result);
  }
}
