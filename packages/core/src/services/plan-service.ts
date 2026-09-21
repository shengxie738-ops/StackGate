import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckPlan, CheckStep, Diagnostic, PlanContext, TaskPayload } from '../../../contracts/src/index.js';
import { resolveOperationKey, validateSchema } from '../../../contracts/src/index.js';
import { captureInputs } from '../../../adapter-git/src/input-manifest.js';
import { normalizePlanDag } from '../domain/plan-dag.js';
import { hashBytes } from '../storage/hash.js';
import { canonicalJson } from '../storage/canonical-json.js';
import { inspectPathWithin, resolveWithin } from '../storage/safe-path.js';
import { ensureDirectoryWithin } from '../storage/task-revisions.js';
import { writeJsonAtomic } from '../storage/atomic-write.js';
import { configurationError, ServiceError } from './service-error.js';
import { parseStrictDocument } from './strict-document.js';
import { TaskService } from './task-service.js';
import { TrustService } from './trust-service.js';
import { ScanService } from './scan-service.js';
import { selectionPolicyFor } from './selection-policy.js';
import { executionInputScope, generatedDirectoryNames } from './execution-input-scope.js';
import { configNames } from './project-service.js';
import { loadConfiguration } from './config-service.js';
import packageMetadata from '../../../../package.json';
import typescriptMetadata from 'typescript/package.json';

const digest = (value: unknown) => hashBytes(Buffer.from(canonicalJson(value)));
export interface PlanRequest { task: string; profile: string; base?: string }
export interface StoredPlan { plan: CheckPlan; context: PlanContext }
export interface PlanInspection {
  valid: boolean; identity_valid: boolean; executable: boolean; freshness: 'FRESH' | 'STALE' | 'UNVERIFIED'; diagnostics: Diagnostic[];
  stored: StoredPlan; current: PlanContext | null; task_confirmed: boolean; trust_valid: boolean;
}
const diagnostic = (code: Diagnostic['code'], message: string): Diagnostic => ({code, message, location: '', source: 'plan-service', observed_facts: {}, recommended_action: 'Review current inputs and create a newly confirmed plan before execution.'});
const stepId = (check: string) => 'step_' + digest(check).slice(0, 24);
function environmentCheck(context: Pick<PlanContext, 'environment_requirements'>) {
  return context.environment_requirements.required ? 'environment_' + digest(context.environment_requirements.environment_id).slice(0, 16) : null;
}
function buildSteps(context: PlanContext): CheckStep[] {
  const {config, task} = context, environment = environmentCheck(context), steps: CheckStep[] = [];
  const dependencies = config.extensions?.stackgate_v0_1?.check_dependencies ?? {};
  for (const check_id of context.required_check_ids) {
    if (check_id === environment && context.environment_requirements.required) {
      steps.push({step_id: stepId(check_id), check_id, adapter_id: 'environment', command_id: null, depends_on: [], required: true, timeout_ms: 60000, resource_locks: [check_id], expected_artifacts: [], expected_test_ids: [], min_tests: null, parameters: {adapter_id: 'environment', environment_id: context.environment_requirements.environment_id}});
      continue;
    }
    const check = config.checks[check_id]; if (!check) throw configurationError('Selected check is missing', check_id);
    const command_id = check.adapter === 'openapi' ? check.candidate_command : check.command, command = config.commands[command_id]!;
    const timeout_ms = command.timeout_seconds * 1000; if (!Number.isSafeInteger(timeout_ms)) throw configurationError('Command timeout exceeds supported range', command_id);
    const depends_on = [...(dependencies[check_id] ?? [])];
    if (environment && ['openapi', 'stackgate-probe', 'playwright'].includes(check.adapter)) depends_on.push(environment);
    if (check.adapter === 'stackgate-probe') depends_on.push(...context.required_check_ids.filter(id => config.checks[id]?.adapter === 'openapi'));
    if (check.adapter === 'playwright') depends_on.push(...context.required_check_ids.filter(id => ['openapi', 'stackgate-probe'].includes(config.checks[id]?.adapter ?? '')));
    let parameters: CheckStep['parameters'];
    if (check.adapter === 'command') parameters = {adapter_id: 'command', result_kind: 'exit-code'};
    else if (check.adapter === 'junit') parameters = {adapter_id: 'junit', report_name: 'junit.xml'};
    else if (check.adapter === 'openapi') parameters = {adapter_id: 'openapi', service: check.service, candidate_artifact: 'candidate-openapi.json'};
    else if (check.adapter === 'stackgate-probe') parameters = {adapter_id: 'stackgate-probe', required_operations: check.required_operations.map(operation => resolveOperationKey(operation, Object.keys(config.contracts))) as [string, ...string[]]};
    else parameters = {adapter_id: 'playwright', required_test_ids: [...new Set([...check.required_test_ids, ...(context.test_assignments[check_id] ?? [])])].sort() as [string, ...string[]], require_real_backend: check.require_real_backend || task.constraints.require_backend_observation};
    const lock = context.workspace_resource_ids[command.workspace]; if (!lock) throw configurationError('Workspace has no confirmed resource identity', command.workspace);
    const step: CheckStep = {step_id: stepId(check_id), check_id, adapter_id: check.adapter, command_id, depends_on: [...new Set(depends_on)].map(stepId), required: true, timeout_ms, resource_locks: [lock], expected_artifacts: check.adapter === 'junit' ? ['junit.xml'] : check.adapter === 'openapi' ? ['candidate-openapi.json'] : check.adapter === 'stackgate-probe' ? ['probe.json'] : check.adapter === 'playwright' ? ['playwright.json'] : [], expected_test_ids: context.test_assignments[check_id] ?? [], min_tests: check.adapter === 'junit' ? check.min_tests : null, parameters};
    const validated = validateSchema<CheckStep>('check-step', step); if (!validated.ok) throw new ServiceError(64, validated.diagnostics);
    steps.push(validated.value);
  }
  try { return normalizePlanDag(steps, context.required_check_ids); } catch (error) { throw configurationError(error instanceof Error ? error.message : 'Invalid plan DAG'); }
}
function planFor(context: PlanContext): CheckPlan {
  const value = {schema_version: '0.1' as const, plan_id: 'plan_' + digest(context), task_id: context.task.task_id, task_revision: context.task.revision, profile: context.profile, input_hash: context.input_manifest.input_hash, policy_hash: context.policy_hash, target_contract_hashes: context.target_contract_hashes, toolchain_hash: context.toolchain_hash, environment_requirements_hash: digest(context.environment_requirements), required_check_ids: context.required_check_ids, steps: buildSteps(context) as [CheckStep, ...CheckStep[]]};
  const plan: CheckPlan = {...value, plan_hash: digest(value)};
  const checked = validateSchema<CheckPlan>('plan', plan); if (!checked.ok) throw new ServiceError(64, checked.diagnostics);
  return checked.value;
}
export function authenticateStoredPlan(stored:StoredPlan):StoredPlan {
  if(!validateSchema('plan',stored.plan).ok||!validateSchema('plan-context',stored.context).ok||canonicalJson(planFor(stored.context))!==canonicalJson(stored.plan))throw configurationError('Stored plan or context integrity mismatch');
  return stored;
}
export class PlanService {
  readonly root: string;
  constructor(root: string, readonly options: {trustStoreRoot?: string} = {}) { this.root = path.resolve(root); }
  private async capture(request: PlanRequest, requireConfirmation: boolean) {
    const trust = new TrustService(this.root, this.options.trustStoreRoot ? {storeRoot: this.options.trustStoreRoot} : {}), snapshot = await trust.capture();
    const config = snapshot.configuration, {profile, policy_hash} = selectionPolicyFor(config, request.profile);
    const task_file = path.relative(this.root, path.resolve(this.root, request.task)).replaceAll(path.sep, '/');
    const parsed = validateSchema<TaskPayload>('task', parseStrictDocument(await fs.readFile(await resolveWithin(this.root, task_file)), task_file));
    if (!parsed.ok) throw new ServiceError(64, parsed.diagnostics); const task = parsed.value;
    const taskService = new TaskService(this.root), validation = await taskService.validate(path.join(this.root, task_file));
    if (!validation.valid || !validation.confirmation_digest) throw new ServiceError(64, validation.diagnostics.length ? validation.diagnostics : configurationError('Task validation has no complete input identity').diagnostics);
    let task_confirmed = false;
    try { task_confirmed = (await taskService.loadConfirmed(task.task_id, task.revision)).confirmation_digest === validation.confirmation_digest; } catch { /* Missing or invalid confirmation is never promoted to authority. */ }
    const review = await trust.review(), trust_valid = review.already_trusted && review.execution_digest === snapshot.execution_digest;
    if (requireConfirmation && !task_confirmed) throw configurationError('Task has no matching current confirmation');
    if (requireConfirmation && !trust_valid) throw configurationError('Execution permissions have no matching reviewed trust record');
    const scan = await new ScanService(this.root).scan({task: task_file, profile: request.profile, base: request.base ?? 'HEAD'});
    if (!scan.baseline || !('impacts' in scan)) throw configurationError('Requested plan baseline is unavailable');
    if (scan.policy_hash !== policy_hash) throw configurationError('Configuration changed while creating the plan');
    const scope = await executionInputScope(this.root, config, snapshot.execution_preview.input_scope.command_inputs);
    const selectionInputs = [...Object.values(config.contracts).map(contract => contract.target_file), ...(scan.input_manifest.files.some(file => file.relative_path === '.stackgate/mappings.json' && file.kind !== 'deleted') ? ['.stackgate/mappings.json'] : [])];
    const input_manifest = await captureInputs({project_id: config.project_id, repo_root: this.root, configuration_hash: snapshot.execution_preview.configuration_hash, workspaces: config.workspaces, contracts: config.contracts}, scan.baseline, {exclusions: [{relative_path: config.state_dir, reason: 'StackGate state'}], include_ignored: [...new Set([...scope.include_ignored, ...selectionInputs])].sort(), required_files: [...new Set([...scope.required_files, ...selectionInputs])].sort(), exclude_untracked_directory_names: generatedDirectoryNames});
    const blockers: PlanContext['blockers'] = [];
    const addBlocker = (code: Diagnostic['code'], message: string, check_id: string | null = null) => { if (!blockers.some(item => item.code === code && item.message === message && item.check_id === check_id)) blockers.push({code, message, check_id}); };
    if (input_manifest.completeness !== 'COMPLETE') addBlocker('INPUT_STALE', 'Execution input inventory is incomplete');
    if (!task_confirmed) addBlocker('TASK_UNCONFIRMED', 'Task has no current matching confirmation');
    if (!trust_valid) addBlocker('EXECUTION_UNTRUSTED', 'Execution permissions are not currently trusted');
    for (const gap of scan.selection.coverage_gaps) addBlocker('UNRESOLVED_IMPACT', gap.workspace + ': ' + gap.reason);
    for (const finding of scan.acceptance_drift.filter(item => item.decision === 'DENY')) addBlocker('PROTECTED_INPUT_CHANGED', finding.message);
    for (const item of scan.diagnostics) addBlocker(item.code, item.message);
    const required = new Set(scan.selection.required_set), dependencies = config.extensions?.stackgate_v0_1?.check_dependencies ?? {};
    const selection_sources: PlanContext['selection_sources'] = Object.fromEntries(scan.selection.selected_checks.map(item => [item.id, [...item.sources] as [string, ...string[]]]));
    const expand = (id: string) => { for (const child of dependencies[id] ?? []) { selection_sources[child] = [...new Set([...(selection_sources[child] ?? []), 'dependency:' + id])].sort() as [string, ...string[]]; if (!required.has(child)) { required.add(child); expand(child); } } };
    for (const id of [...required]) expand(id);
    const environment_requirements: PlanContext['environment_requirements'] = profile.environment === null ? {required: false} : {required: true, environment_id: profile.environment, configuration: config.environments[profile.environment]!, minimum_provenance: profile.minimum_provenance};
    if (environment_requirements.required) {
      const id = environmentCheck({environment_requirements})!; if (config.checks[id]) throw configurationError('Environment check identity collides with a configured check');
      required.add(id); selection_sources[id] = ['profile-environment:' + request.profile]; addBlocker('ENV_PROVENANCE_INSUFFICIENT', 'External environment observation and ownership are not available in M2', id);
    } else if (task.constraints.require_backend_observation) addBlocker('ENV_PROVENANCE_INSUFFICIENT', 'Task requires backend observation; a local profile cannot satisfy it');
    const test_assignments: Record<string, string[]> = {}, junit = [...required].filter(id => config.checks[id]?.adapter === 'junit').sort();
    for (const id of required) {
      const check = config.checks[id];
      if (check?.adapter === 'playwright') test_assignments[id] = [...check.required_test_ids];
      if (check && !['command', 'junit'].includes(check.adapter)) addBlocker('UNSUPPORTED_CAPABILITY', 'Adapter requires capabilities outside the M2 local command/JUnit execution subset', id);
    }
    for (const testId of task.required_test_ids) {
      const mapped = [...scan.impacts.known, ...scan.impacts.candidate].filter(item => item.test_ids.includes(testId)).flatMap(item => item.check_ids).filter(id => required.has(id) && ['junit', 'playwright'].includes(config.checks[id]?.adapter ?? ''));
      const declared = [...required].filter(id => config.checks[id]?.adapter === 'playwright' && (config.checks[id] as {required_test_ids: string[]}).required_test_ids.includes(testId));
      const destinations = [...new Set([...mapped, ...declared, ...(!mapped.length && !declared.length && junit.length === 1 ? junit : [])])];
      if (!destinations.length) addBlocker('REQUIRED_TEST_MISSING', 'Required test has no unambiguous executable collector assignment: ' + testId);
      for (const id of destinations) test_assignments[id] = [...new Set([...(test_assignments[id] ?? []), testId])].sort();
    }
    const target_contract_hashes: Record<string, string> = {};
    for (const [service, contract] of Object.entries(config.contracts)) {
      const file = input_manifest.files.find(item => item.relative_path === contract.target_file);
      if (!file?.digest || file.kind !== 'file') throw configurationError('Target contract has no verified raw input identity', contract.target_file);
      target_contract_hashes[service] = file.digest;
    }
    for (const contract of scan.contracts) if (contract.compatibility.status !== 'PASS') addBlocker(contract.compatibility.status === 'FAIL' ? 'CONTRACT_MISMATCH' : 'UNSUPPORTED_CAPABILITY', 'Static contract compatibility is not satisfied: ' + contract.service_id);
    const tools = snapshot.execution_preview.tools, analysis = snapshot.execution_preview.analysis_tools;
    const workspace_resource_ids: Record<string, string> = {};
    for (const [id, workspace] of Object.entries(config.workspaces)) {
      const actual = await fs.realpath(await resolveWithin(this.root, workspace.path));
      if (!(await fs.stat(actual)).isDirectory()) throw configurationError('Workspace resource is not a directory', id);
      workspace_resource_ids[id] = 'workspace_' + digest(process.platform === 'win32' ? actual.toLowerCase() : actual).slice(0, 24);
    }
    const tool_versions: Record<string, string> = {node: process.version.slice(1), stackgate: packageMetadata.version, typescript: typescriptMetadata.version, oasdiff: analysis.oasdiff.status === 'VERIFIED' ? analysis.oasdiff.tool.version : 'UNKNOWN'};
    for (const [id, tool] of Object.entries(tools)) tool_versions['command_' + id] = tool.invocation?.package_version ?? tool.invocation?.identity.version ?? 'UNKNOWN';
    const context: PlanContext = {schema_version: '0.1', task_file, base_ref: request.base ?? 'HEAD', profile: request.profile, config, task, input_manifest, configuration_hash: snapshot.execution_preview.configuration_hash, confirmation_digest: validation.confirmation_digest, execution_digest: snapshot.execution_digest, policy_hash, toolchain_hash: digest({tools, analysis, runner_provenance: 'runner_provenance' in snapshot.execution_preview ? snapshot.execution_preview.runner_provenance : null}), tool_versions, target_contract_hashes, environment_requirements, required_check_ids: [...required].sort() as [string, ...string[]], test_assignments, selection_sources, analysis_gaps: scan.selection.analysis_gaps.map(({workspace, reference, reason, origin}) => ({workspace, reference, reason, origin})), workspace_resource_ids, blockers};
    const checked = validateSchema<PlanContext>('plan-context', context); if (!checked.ok) throw new ServiceError(64, checked.diagnostics);
    return {context: checked.value, task_confirmed, trust_valid};
  }
  async create(request: PlanRequest): Promise<CheckPlan> {
    const captured = await this.capture(request, true), context = captured.context, plan = planFor(context);
    const directory = `${context.config.state_dir}/plans/${plan.plan_id}`;
    try { const previous = await this.load(plan.plan_id); if (canonicalJson(previous.context) !== canonicalJson(context) || canonicalJson(previous.plan) !== canonicalJson(plan)) throw configurationError('Existing plan identity mismatch'); return previous.plan; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const current = await this.capture(request, true);
    if (digest(current.context) !== digest(context)) throw configurationError('Inputs changed during plan creation');
    await ensureDirectoryWithin(this.root, directory);
    await writeJsonAtomic(await resolveWithin(this.root, directory + '/context.json'), context, {root: this.root});
    await writeJsonAtomic(await resolveWithin(this.root, directory + '/plan.json'), plan, {root: this.root});
    return plan;
  }
  async load(plan_id: string): Promise<StoredPlan> {
    if (!/^plan_[a-f0-9]{64}$/.test(plan_id)) throw configurationError('Invalid plan ID');
    // Reading configured location never authorizes the current commands or executes a tool.
    const names: string[] = [];
    for (const name of configNames) try { await fs.access(await resolveWithin(this.root, name)); names.push(name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (names.length !== 1) throw configurationError('Exactly one configuration is required to locate stored plans');
    const configuration = await loadConfiguration(path.join(this.root, names[0]!), this.root);
    const directory = `${configuration.state_dir}/plans/${plan_id}`;
    const read = async (name: string) => {
      const maxBytes = 16 * 1024 * 1024, relative = directory + '/' + name;
      const inspected = await inspectPathWithin(this.root, relative), before = await fs.lstat(inspected.path);
      if (inspected.links.length || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maxBytes) throw configurationError('Stored plan file exceeds its budget or is not an ordinary unlinked file');
      const handle = await fs.open(inspected.path, 'r');
      try {
        const opened = await handle.stat();
        if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw configurationError('Stored plan file changed while opening');
        const bytes = Buffer.alloc(Math.min(maxBytes + 1, before.size + 1)); let length = 0;
        while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length, null); if (!read.bytesRead) break; length += read.bytesRead; }
        const after = await handle.stat(), finalPath = await inspectPathWithin(this.root, relative), final = await fs.lstat(finalPath.path);
        if (length > maxBytes || length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || final.ino !== before.ino || final.dev !== before.dev || final.nlink !== 1 || finalPath.links.length) throw configurationError('Stored plan file changed during bounded read');
        return parseStrictDocument(bytes.subarray(0, length), name, {maxBytes});
      } finally { await handle.close(); }
    };
    const planResult = validateSchema<CheckPlan>('plan', await read('plan.json')), contextResult = validateSchema<PlanContext>('plan-context', await read('context.json'));
    if (!planResult.ok || !contextResult.ok) throw configurationError('Stored plan or context schema is invalid');
    const plan = planResult.value, context = contextResult.value;
    if (plan.plan_id !== plan_id || canonicalJson(planFor(context)) !== canonicalJson(plan)) throw configurationError('Stored plan or context integrity mismatch');
    return {plan, context};
  }
  async inspectCurrent(plan_id: string): Promise<PlanInspection> {
    return this.inspectStored(await this.load(plan_id));
  }
  async inspectStored(value:StoredPlan):Promise<PlanInspection> {
    const stored=authenticateStoredPlan(value);
    try {
      const capture = await this.capture({task: stored.context.task_file, profile: stored.context.profile, base: stored.context.base_ref}, false);
      const identical = digest({...capture.context, blockers: []}) === digest({...stored.context, blockers: []});
      const diagnostics = capture.context.blockers.map(item => diagnostic(item.code, item.message));
      if (!identical) diagnostics.unshift(diagnostic('PLAN_STALE', 'Current plan inputs differ from the immutable plan context'));
      const identity_valid = identical && capture.task_confirmed && capture.trust_valid, executable = identity_valid && !diagnostics.length;
      return {valid: executable, identity_valid, executable, freshness: identical ? 'FRESH' : 'STALE', diagnostics, stored, current: capture.context, task_confirmed: capture.task_confirmed, trust_valid: capture.trust_valid};
    } catch (error) {
      return {valid: false, identity_valid: false, executable: false, freshness: 'UNVERIFIED', diagnostics: error instanceof ServiceError ? error.diagnostics : [diagnostic('PLAN_STALE', 'Current inputs cannot be safely verified')], stored, current: null, task_confirmed: false, trust_valid: false};
    }
  }
}
