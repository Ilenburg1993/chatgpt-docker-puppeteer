/*
 * Compatibility wrapper: export NERV factory as default
 * Historical tooling and diagnostic scripts import `src/nerv/core`
 * while the canonical implementation lives in `src/nerv/nerv.js`.
 */

const { createNERV } = require('./nerv');

module.exports = createNERV;
