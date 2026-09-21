import {randomUUID} from 'node:crypto';
import type {GateEvaluationDocument} from '../../../contracts/src/generated/gate-evaluation.js';
import {validateSchema} from '../../../contracts/src/index.js';
import {ensureDirectoryWithin} from './task-revisions.js';
import {strictPath,assertRunId} from './run-layout.js';
import {writeJsonAtomic} from './atomic-write.js';
export async function storeEvaluation(stateRoot:string,evaluation:GateEvaluationDocument):Promise<string>{
 assertRunId(evaluation.run_id);if(!validateSchema('gate-evaluation',evaluation).ok)throw Error('Invalid Gate evaluation document');
 const directory=`evaluations/${evaluation.run_id}`;await ensureDirectoryWithin(stateRoot,directory);
 const destination=await strictPath(stateRoot,`${directory}/evaluation_${randomUUID()}.json`);await writeJsonAtomic(destination,evaluation,{root:stateRoot});return destination;
}
