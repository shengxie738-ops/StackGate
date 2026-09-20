import type { LoadedContract } from './load-contract.js';
export interface OperationScope { operation_scope: string[]; conservative: boolean }
/** Empty or unknown scope never proves that no operation is affected. */
export function resolveOperationScope(contract: LoadedContract, requested?: readonly string[]): OperationScope {
  const all = contract.operations.map((operation) => operation.key);
  const known = new Set(all);
  const conservative = requested !== undefined && (requested.length === 0 || requested.some((key) => !known.has(key)));
  return { operation_scope: !requested || conservative ? all : [...new Set(requested)].sort(), conservative };
}
