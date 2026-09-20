/** Infrastructure supplies real UTC time and collision-resistant IDs; domain receives values. */
export interface Clock { now(): string }
export type IdKind = 'plan' | 'run' | 'event' | 'attempt' | 'artifact' | 'step' | 'resource';
export interface IdFactory { create<K extends IdKind>(kind: K): `${K}_${string}` }
