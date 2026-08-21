// @ts-check
/** Shared coalescing state for index directory builds. */

/** @type {Map<string, Promise<unknown>>} */
export const inflightIndexBuilds = new Map();
