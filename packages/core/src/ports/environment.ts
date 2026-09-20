import type { Diagnostic, EffectivePolicy, EnvironmentManifest, ProjectConfig } from '../../../contracts/src/index.js';
import type { ExecutionContext } from './adapter.js';
export interface EnvironmentRequest {
  run_id: string; environment_id: string; input_hash: string;
  configuration: ProjectConfig['environments'][string]; policy: EffectivePolicy;
}
export type OwnedResource = EnvironmentManifest['resources'][number];
export interface CleanupResult { cleaned: OwnedResource[]; preserved: OwnedResource[]; failed: OwnedResource[]; diagnostics: Diagnostic[] }
export interface EnvironmentPort {
  prepare(request: EnvironmentRequest, context: ExecutionContext): Promise<EnvironmentManifest>;
  observe(request: { manifest: EnvironmentManifest; expected_input_hash: string; signal: AbortSignal }): Promise<EnvironmentManifest>;
  cleanup(request: { run_id: string; owner_token: string; resources: readonly OwnedResource[]; signal: AbortSignal }): Promise<CleanupResult>;
}
