import type { Artifact, CheckPlan, CheckResult, Diagnostic, RunEvent, RunManifest, InputManifest, EnvironmentManifest, Finding, PlanContext, RunCompletion } from '../../../contracts/src/index.js';
export interface ArtifactWrite {
  name: string; media_type: string; bytes: Uint8Array;
  artifact_kind: NonNullable<Artifact['artifact_kind']>;
  sensitivity: Artifact['sensitivity']; redaction_state: Artifact['redaction_state'];
  retention?: Artifact['retention'];
}
export interface RestrictedArtifactWriter {
  /** A run/check/attempt-scoped implementation enforces name containment and budget. */
  store(artifact: ArtifactWrite): Promise<Artifact>;
}
export interface RestrictedLogWriter { append(stream: 'stdout' | 'stderr' | 'diagnostic', text: string): Promise<void> }
export type EvidenceDocument = { kind: 'plan'; value: CheckPlan } | { kind: 'run'; value: RunManifest } | { kind: 'check-result'; value: CheckResult } | {kind:'input-manifest';value:InputManifest} | {kind:'environment';value:EnvironmentManifest} | {kind:'finding';value:Finding} | {kind:'plan-context';value:PlanContext} | {kind:'run-completion';value:RunCompletion};
export interface EvidenceScope { run_id: string; check_id: string | null; attempt_id: string | null }
export type AppendResult = { status: 'APPENDED' | 'DUPLICATE'; event_id: string; seq: number } | { status: 'ERROR'; diagnostics: Diagnostic[] };
export interface SealResult { status: 'SEALED' | 'BLOCKED' | 'ERROR'; manifest_hash: string | null; artifacts: Artifact[]; diagnostics: Diagnostic[] }
export type EvidenceRead = { status: 'FOUND'; artifact: Artifact; bytes: Uint8Array } | { status: 'MISSING' | 'INVALID'; diagnostics: Diagnostic[] };
export interface EvidenceStore {
  append(event: RunEvent): Promise<AppendResult>;
  store(scope: EvidenceScope, input: { kind: 'artifact'; value: ArtifactWrite } | { kind: 'document'; value: EvidenceDocument }): Promise<Artifact>;
  seal(request: { run_id: string; input_hash: string; required_artifact_ids: readonly string[] }): Promise<SealResult>;
  read(request: { run_id: string; relative_path: string; expected_digest: string; max_bytes: number }): Promise<EvidenceRead>;
}
/** Renderers receive this read-only capability, never the writer or a runner. */
export type EvidenceReader = Pick<EvidenceStore, 'read'>;
