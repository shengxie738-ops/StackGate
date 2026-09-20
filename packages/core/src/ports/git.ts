import type { Diagnostic, InputManifest } from '../../../contracts/src/index.js';
export interface BaselineIdentity {
  base_oid: string; head_oid: string; target_tip_oid: string;
  git_object_format: 'sha1' | 'sha256'; source_ref: string;
}
export type BaselineResolution = { ok: true; baseline: BaselineIdentity } | { ok: false; diagnostics: Diagnostic[] };
export interface GitPort {
  resolveBaseline(request: { repo_root: string; target_ref: string; candidate_ref: string; signal: AbortSignal }): Promise<BaselineResolution>;
  capture(request: { repo_root: string; baseline: BaselineIdentity; exclusions: readonly { relative_path: string; reason: string }[]; signal: AbortSignal }): Promise<InputManifest>;
}
