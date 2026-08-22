#!/usr/bin/env node
// @ts-check
/**
 * Fail-fast CI gate for semantic Infra public path-authority metadata and AST-resolved callable signatures.
 * @module scripts/ci/check-infra-public-api-authority
 */

import { buildInfraPublicAuthorityReport } from '#copilot/infra/public/diagnostic/governance';

const report = buildInfraPublicAuthorityReport();
process.stdout.write(
    `${JSON.stringify(
        {
            success: report.success,
            metadataViolations: report.metadataViolations,
            signatureViolations: report.signatureViolations,
            pathSignatureFindings: report.signatureFindings.length,
            unresolvedNonCallableOrIndirectExports: report.unresolvedExports.length,
        },
        null,
        2,
    )}\n`,
);
if (!report.success) process.exitCode = 1;
