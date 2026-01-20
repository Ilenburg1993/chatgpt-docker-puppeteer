/**
 * Barrel export for centralized constants
 * Provides type-safe access to all application constants
 *
 * @module constants
 */

const tasks = require('./tasks.js');
const logging = require('./logging.js');
const browser = require('./browser.js');

module.exports = {
    ...tasks,
    ...logging,
    ...browser
};
