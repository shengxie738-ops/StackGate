import type { Artifact, AdapterCapabilities, CheckResult, CheckStep, Diagnostic, EffectivePolicy, InputManifest, ProjectConfig, RunEvent } from '../../../contracts/src/index.js';
import type { Clock, IdFactory } from './clock.js';
import type { AuthorizedRunner } from './runner.js';
import type { EvidenceReader, RestrictedArtifactWriter, RestrictedLogWriter } from './evidence.js';
export interface ProjectContext {
  project_id: string; repo_root: string; configuration_hash: string;
  workspaces: Readonly<ProjectConfig['workspaces']>; contracts: Readonly<ProjectConfig['contracts']>;
}
type ConfiguredCheck = ProjectConfig['checks'][string];
interface ConfigurationByAdapter {
  command: Extract<ConfiguredCheck, { adapter: 'command' }>;
  junit: Extract<ConfiguredCheck, { adapter: 'junit' }>;
  openapi: Extract<ConfiguredCheck, { adapter: 'openapi' }>;
  'stackgate-probe': Extract<ConfiguredCheck, { adapter: 'stackgate-probe' }>;
  playwright: Extract<ConfiguredCheck, { adapter: 'playwright' }>;
  environment: { environment_id: string; environment: ProjectConfig['environments'][string] };
}
export type AdapterId = keyof ConfigurationByAdapter;
export type AdapterConfig = { [K in AdapterId]: { adapter_id: K; check_id: string; config: ConfigurationByAdapter[K] } }[AdapterId];
export type AdapterInputs = { [K in AdapterId]: {
  adapter_id: K; configuration: Extract<AdapterConfig, { adapter_id: K }>;
  project: ProjectContext; input_manifest: InputManifest;
  required_operations: readonly string[]; required_test_ids: readonly string[];
} }[AdapterId];
export interface ExecutionContext {
  run_id: string; check_id: string; attempt_id: string;
  allowed_paths: readonly string[]; allowed_origins: readonly string[];
  environment: Readonly<Record<string, string>>; signal: AbortSignal;
  commands: AuthorizedRunner; log: RestrictedLogWriter; artifacts: RestrictedArtifactWriter;
  clock: Clock; ids: IdFactory;
}
export interface CollectionContext {
  run_id: string; check_id: string; attempt_id: string;
  expected_artifacts: readonly string[]; evidence: EvidenceReader; signal: AbortSignal;
  /** Metadata from the scoped evidence index; bytes must still pass EvidenceReader verification. */
  artifacts?: readonly Artifact[];
}
export interface Adapter {
  describe(): AdapterCapabilities;
  validate(config: AdapterConfig, project: ProjectContext): Promise<Diagnostic[]>;
  plan(inputs: AdapterInputs, policy: EffectivePolicy): Promise<CheckStep[]>;
  execute(step: CheckStep, context: ExecutionContext): AsyncIterable<RunEvent>;
  collect(step: CheckStep, context: CollectionContext): Promise<CheckResult>;
}
