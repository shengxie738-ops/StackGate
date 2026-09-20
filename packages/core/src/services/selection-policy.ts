import type { ProjectConfig } from '../../../contracts/src/index.js';
import type { SelectionPolicy } from '../domain/select-checks.js';
import { canonicalJson } from '../storage/canonical-json.js';
import { hashBytes } from '../storage/hash.js';
import { configurationError } from './service-error.js';

/** Scan and Plan share the same configured authority; the caller verifies task confirmation. */
export function selectionPolicyFor(config: ProjectConfig, profileName: string) {
  const profile = config.profiles[profileName];
  if (!profile) throw configurationError('Unknown profile', profileName);
  const selection_policy: SelectionPolicy = {
    required_set: [...profile.required_checks],
    workspace_ids: Object.keys(config.workspaces).sort(),
    workspace_regression: profile.unknown_impact === 'workspace-regression' ? profile.workspace_regression ?? {} : {},
    optional_failure_policy: 'incomplete',
  };
  return { profile, selection_policy, policy_hash: hashBytes(Buffer.from(canonicalJson({ profile_name: profileName, configuration: config }))) };
}
