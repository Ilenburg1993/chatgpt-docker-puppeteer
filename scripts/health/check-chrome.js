#!/usr/bin/env node
// @ts-check
import { ConnectionOrchestrator } from '#infra/ConnectionOrchestrator';
(async () => {
    try {
        const report = await ConnectionOrchestrator.synchronize();
        console.log(JSON.stringify(report, null, 2));
        process.exit(0);
    } catch (err) {
        const _ce = /** @type {any} */ (err);
        console.error('Error during proxy synchronization:', err && _ce.message ? _ce.message : err);
        process.exit(2);
    }
})();
