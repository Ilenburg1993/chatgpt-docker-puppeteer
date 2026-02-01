#!/usr/bin/env node
// scripts/check-chrome.js
// Executa um check rápido usando ConnectionOrchestrator.synchronize()
require('module-alias/register');
const { ConnectionOrchestrator } = require('../src/infra/ConnectionOrchestrator');
(async () => {
    try {
        const report = await ConnectionOrchestrator.synchronize();
        console.log(JSON.stringify(report, null, 2));
        process.exit(0);
    } catch (err) {
        console.error('Error during proxy synchronization:', err && err.message ? err.message : err);
        process.exit(2);
    }
})();
