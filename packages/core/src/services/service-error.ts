import type { Diagnostic } from '../../../contracts/src/diagnostic.js';
export class ServiceError extends Error {
  constructor(readonly exit_code: 2 | 3 | 64, readonly diagnostics: Diagnostic[]) { super(diagnostics.map(d=>d.message).join('; ')); this.name='ServiceError'; }
}
export function configurationError(message:string,location='',source='configuration'):ServiceError {
  return new ServiceError(64,[{code:'CONFIG_INVALID',rule_id:'SG-POLICY-CONFIGURATION',message,location,observed_facts:{},recommended_action:'Correct the declared configuration; no business command was executed.',source}]);
}
