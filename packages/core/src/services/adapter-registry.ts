import type { Adapter, AdapterId } from '../ports/adapter.js';
import type { PlanContext } from '../../../contracts/src/index.js';

export type AdapterFactory = (context: PlanContext) => Adapter;

export interface RuntimeAdapterRegistry {
  /** Returns null when no reviewed factory is installed for the id; never a permissive stub. */
  get(id: AdapterId, context: PlanContext): Adapter | null;
  isInstalled(id: AdapterId): boolean;
  supportedIds(): readonly AdapterId[];
}

/**
 * Plan capability negotiation, Run execution and Gate re-collection must resolve adapters through the
 * same instance, so an adapter cannot exist on one side only.
 */
export function createRuntimeAdapterRegistry(factories: Partial<Record<AdapterId, AdapterFactory>> = {}): RuntimeAdapterRegistry {
  const installed = new Map<AdapterId, AdapterFactory>();
  for (const [id, factory] of Object.entries(factories) as [AdapterId, AdapterFactory | undefined][]) {
    if (installed.has(id)) throw new Error(`Duplicate adapter factory for ${id}`);
    if (typeof factory !== 'function') throw new Error(`Adapter factory for ${id} must be a function`);
    installed.set(id, factory);
  }
  const supported = Object.freeze([...installed.keys()].sort());
  return {
    get(id, context) {
      const factory = installed.get(id);
      return factory ? factory(context) : null;
    },
    isInstalled: id => installed.has(id),
    supportedIds: () => supported,
  };
}

export function missingAdapters(registry: RuntimeAdapterRegistry, ids: readonly AdapterId[]): AdapterId[] {
  return ids.filter(id => !registry.isInstalled(id));
}

import { CommandAdapter } from '../../../adapter-command/src/command-adapter.js';
import { JunitAdapter } from '../../../adapter-junit/src/junit-adapter.js';

/** Only reviewed built-in adapters with both an execution and an authentication path are listed here. */
export function builtinAdapterFactories(): Partial<Record<AdapterId, AdapterFactory>> {
  return {
    command: context => new CommandAdapter(context.config.commands),
    junit: context => new JunitAdapter(context.config.commands),
  };
}

export function defaultRuntimeAdapterRegistry(): RuntimeAdapterRegistry {
  return createRuntimeAdapterRegistry(builtinAdapterFactories());
}
