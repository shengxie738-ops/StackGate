import type { Artifact, Diagnostic } from '../../../contracts/src/index.js';
export interface CommandIdentity { executable: string; version: string; digest: string }
export interface ResolvedCommand {
  command_id: string; identity: CommandIdentity; args: readonly string[]; cwd: string;
  environment: Readonly<Record<string, string>>; timeout_ms: number;
  authorization_hash: string; command_hash: string;
}
export interface ProcessIdentity { pid: number; creation_identity: string; owner_token: string }
export interface RunnerResult {
  status: 'EXITED' | 'TIMED_OUT' | 'CANCELED' | 'ERROR'; raw_exit_code: number | null;
  signal: string | null; process: ProcessIdentity | null; artifacts: readonly Artifact[]; diagnostics: Diagnostic[];
}
export interface RunnerPort {
  run(command: ResolvedCommand, context: {
    run_id: string; check_id: string; attempt_id: string; signal: AbortSignal;
    stdout(chunk: Uint8Array): Promise<void>; stderr(chunk: Uint8Array): Promise<void>;
  }): Promise<RunnerResult>;
}
/** Adapter context gets only reviewed command IDs, never arbitrary executable/argv. */
export interface AuthorizedRunner { run(command_id: string): Promise<RunnerResult> }
