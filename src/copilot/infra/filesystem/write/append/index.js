// @ts-check
/** @module copilot/infra/filesystem/write/append */

export { appendTextLocked, openDetachedAppendSinkLocked } from './locked.js';
export { openDetachedAppendSinkUnlocked } from './sink.js';
export { appendFileUnlocked } from './unlocked.js';
