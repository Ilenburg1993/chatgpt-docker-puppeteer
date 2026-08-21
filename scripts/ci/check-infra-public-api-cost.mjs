#!/usr/bin/env node
// @ts-check
import {
    buildInfraMutableStateReport,
    buildInfraPublicApiCostReport,
} from '#copilot/infra/public/diagnostic/governance';
const cost = await buildInfraPublicApiCostReport();
const mutableState = buildInfraMutableStateReport();
const report = { success: cost.success && mutableState.success, cost, mutableState };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.success) process.exitCode = 1;
