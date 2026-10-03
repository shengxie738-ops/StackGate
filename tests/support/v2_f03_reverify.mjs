// Reproduce V2-F03 (request id cited where a stored artifact id belongs) against a committed revision or the
// working copy. One script, two sources, so the difference cannot come from anything but the module's rules.
//
//   node tests/support/v2_f03_reverify.mjs head        -> 56003cf: a citation that is in no index still passes
//   node tests/support/v2_f03_reverify.mjs worktree    -> the same citation refused, and real refs accepted
//
// The two revisions take different inputs by design: the older signature accepted a bare observation, the
// newer one only accepts an observation paired with stored artifact ids. Each mode builds what its own
// signature asks for, so both runs exercise the rule that revision actually implements.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mode = process.argv[2] ?? '';
const revision = process.argv[3] ?? '2791cf5';
const relative = 'packages/core/src/services/environment-assessment.ts';
if (!['head', 'worktree'].includes(mode)) {
  console.error('usage: node tests/support/v2_f03_reverify.mjs head|worktree [revision]');
  process.exit(64);
}
const contents = mode === 'worktree'
  ? readFileSync(relative, 'utf8')
  : (() => {
    const shown = spawnSync('git', ['show', `${revision}:${relative}`], {encoding: 'utf8'});
    if (shown.status !== 0) { console.error(`cannot read ${revision}:${relative}: ${shown.stderr}`); process.exit(2); }
    return shown.stdout;
  })();

const result = await build({
  stdin: {contents, resolveDir: path.resolve('packages/core/src/services'), loader: 'ts', sourcefile: relative},
  bundle: true, platform: 'node', format: 'esm', target: 'node24', write: false,
  banner: {js: "import { createRequire as __sgRequire } from 'node:module'; const require = __sgRequire(import.meta.url);"},
});
const work = mkdtempSync(path.join(tmpdir(), 'stackgate-v2f03-'));
const file = path.join(work, 'environment-assessment.mjs');
writeFileSync(file, result.outputFiles[0].text);
const mod = await import(pathToFileURL(file).href);

// Fixtures come from the repository's own protocol fixtures so the documents are schema-valid bytes rather
// than a hand-made shape that would only prove the test's own assumptions.
const readFixture = name => JSON.parse(readFileSync(path.resolve('tests/fixtures/protocols', `${name}.json`), 'utf8'));
const prepare = {...readFixture('environment'), status: 'READY', provenance: 'OBSERVED'};
const finalization = {...readFixture('environment-finalization'), provenance: 'OBSERVED',
  run_id: prepare.run_id, instance_id: prepare.instance_id, input_hash: prepare.input_hash,
  data_revision: prepare.data_revision, phase: 'finalize', instance_changed: false};
const cleanup = {...readFixture('environment-cleanup'), run_id: prepare.run_id};
const observation = {...readFixture('backend-observation'), run_id: prepare.run_id, instance_id: prepare.instance_id};
const digest = observation.response_digest;

const REQUEST_ID = observation.request_id;          // an HTTP request identity, never a stored artifact
const PREPARE_REF = 'art_environment_prepare';
const FINALIZE_REF = 'art_environment_finalization';
const CLEANUP_REF = 'art_environment_cleanup';
// The stored id the newer signature needs for the observation document, distinct from the request id by
// construction: it is minted here, while REQUEST_ID comes from the fixture's own identity field.
const OBSERVATION_ARTIFACT = 'art_backend_observation_document';
const RESPONSE_ARTIFACT = 'art_response_body';

const requirements = {
  required_by_profile: true, required_by_task: true, requires_backend_observation: true,
  minimum_provenance: 'DECLARED', expected_data_revision: prepare.data_revision,
  expected_origins: {frontend: prepare.frontend_origin ?? null, backend: prepare.backend_origin ?? null},
  required_operations: [observation.operation_key],
};
const indexed = [PREPARE_REF, FINALIZE_REF, CLEANUP_REF];

const input = mode === 'worktree'
  ? {run_id: prepare.run_id, expected_input_hash: prepare.input_hash, requirements,
    run_window: {started_at: observation.started_at, finished_at: observation.finished_at},
    prepare, finalization, cleanup,
    observations: [{observation, artifact_ids: [OBSERVATION_ARTIFACT, RESPONSE_ARTIFACT]}],
    authenticated_refs: [...indexed, OBSERVATION_ARTIFACT, RESPONSE_ARTIFACT],
    authenticated_digests: {[REQUEST_ID]: digest},
    prepare_ref: PREPARE_REF, finalization_ref: FINALIZE_REF, cleanup_ref: CLEANUP_REF}
  : {run_id: prepare.run_id, expected_input_hash: prepare.input_hash, ...requirements,
    run_window: {started_at: observation.started_at, finished_at: observation.finished_at},
    prepare, finalization, cleanup, observations: [observation],
    authenticated_refs: [...indexed, REQUEST_ID], authenticated_digests: {[REQUEST_ID]: digest},
    prepare_ref: PREPARE_REF, finalization_ref: FINALIZE_REF, cleanup_ref: CLEANUP_REF};

const assessment = mod.assessEnvironment(input);
console.log(`[${mode}] satisfied=${assessment.satisfied} observation_refs=${JSON.stringify(assessment.observation_refs)}`);
console.log(`[${mode}] REQUEST_ID=${REQUEST_ID} stored observation artifact=${OBSERVATION_ARTIFACT} distinct=${REQUEST_ID !== OBSERVATION_ARTIFACT}`);

// Exit 1 means the defect is observable in the source that was loaded, whichever revision that is.
const citesRequestId = assessment.observation_refs.includes(REQUEST_ID);
const wrong = mode === 'head'
  ? citesRequestId
  : (citesRequestId || !assessment.observation_refs.includes(OBSERVATION_ARTIFACT));
console.log(`[${mode}] refs_cite_request_id=${citesRequestId} stored_artifact_cited=${assessment.observation_refs.includes(OBSERVATION_ARTIFACT)}`);
console.log(`V2F03_STILL_PRESENT=${wrong ? 'yes' : 'none'}`);
rmSync(work, {recursive: true, force: true});
process.exitCode = wrong ? 1 : 0;
