#!/usr/bin/env node
// @ts-check
import {
    buildInfraMutableStateReport,
    buildInfraPublicApiCostReport,
} from '#copilot/infra/public/diagnostic/governance';
const cost = await buildInfraPublicApiCostReport();
const mutableState = buildInfraMutableStateReport();
const report = { success: cost.success && mutableState.success, cost, mutableState };
const output = report.success
    ? {
          success: true,
          cost: {
              entryCount: cost.entries.length,
              violationCount: cost.violations.length,
          },
          mutableState: {
              detectedCount: mutableState.detected.length,
              declaredCount: mutableState.declared.length,
              undeclaredCount: mutableState.undeclared.length,
              staleCount: mutableState.stale.length,
              invalidScopeCount: mutableState.invalidScopes.length,
              byScope: mutableState.byScope,
          },
      }
    : report;
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!report.success) process.exitCode = 1;
