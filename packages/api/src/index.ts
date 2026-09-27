export { createApp, demoAuth, type App, type AppOptions, type AuthStrategy, type Env } from './app.ts';
export { ApiError, many, one, type Db } from './db.ts';
export { EventBus, type QuoteEvent } from './events.ts';
export { migrate, MIGRATIONS } from './schema.ts';
export { CUSTOMERS, SAMPLE_LISTS, USERS, seedHistory, seedReference } from './seed.ts';
export * from './services.ts';

import { EventBus } from './events.ts';
import { catalogLoader, defaultIds, type Ctx } from './services.ts';
import type { Db } from './db.ts';

/** Wires a database into a service context with real clocks and ids. */
export function createCtx(db: Db, overrides: Partial<Ctx> = {}): Ctx {
  return { db, events: new EventBus(), now: () => new Date(), ...defaultIds(), catalog: catalogLoader(db), ...overrides };
}
