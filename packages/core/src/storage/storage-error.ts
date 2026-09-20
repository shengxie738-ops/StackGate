export type StorageErrorCode = 'UNSAFE_PATH' | 'PATH_CASE_CONFLICT' | 'UNSUPPORTED_PATH_ENCODING' | 'INVALID_JSON' | 'TARGET_EXISTS' | 'TARGET_CHANGED' | 'WRITE_BUSY';
/** Stable codes at the storage boundary; callers translate them to product diagnostics. */
export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode, message: string) { super(message); this.name = 'StorageError'; }
}
