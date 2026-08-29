// @ts-check
/** Repository patch post-validation policy and execution orchestration. */

import { normalizeFocusedUnitTestFiles, runCopilotValidatorInline } from '#copilot/mcp/public/validation';

export const POST_PATCH_VALIDATOR_NAMES = /** @type {const} */ ([
    'typecheck',
    'lint',
    'unit-focused',
    'devcontainer-shell',
    'network-contracts',
]);

export const MAX_POST_PATCH_VALIDATORS = 4;

/**
 * Validate post-patch validator configuration before any file is modified.
 *
 * @param {{
 *     validator: string;
 *     testFile?: string | undefined;
 *     timeoutMs?: number | undefined;
 *     waitMs?: number | undefined;
 *     failureTailBytes?: number | undefined;
 * }[]} requests
 */
export function normalizePostPatchValidationRequests(requests) {
    return requests.map((request) => {
        if (request.validator === 'unit-focused') {
            if (!request.testFile) throw new Error('postValidate unit-focused requires testFile.');
            normalizeFocusedUnitTestFiles([request.testFile]);
        } else if (request.testFile) {
            throw new Error('postValidate testFile is valid only with unit-focused.');
        }
        return {
            validator: /** @type {import('#copilot/mcp/public/validation').CopilotValidatorName} */ (request.validator),
            ...(request.testFile ? { testFile: request.testFile } : {}),
            ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
            ...(request.waitMs === undefined ? {} : { waitMs: request.waitMs }),
            ...(request.failureTailBytes === undefined ? {} : { failureTailBytes: request.failureTailBytes }),
        };
    });
}

/**
 * @param {ReturnType<typeof normalizePostPatchValidationRequests>} requests
 * @param {import('../contracts.js').RepoWriteRuntime} runtime
 * @param {import('#copilot/mcp/public/validation').McpValidationProcessConfig} validationConfig
 */
export async function runPostPatchValidations(requests, runtime, validationConfig) {
    const startedAt = Date.now();
    const results = [];
    for (const [index, request] of requests.entries()) {
        try {
            const result = await runCopilotValidatorInline(request.validator, {
                workspace: runtime.workspace,
                config: validationConfig,
                ownerPrincipalKey: runtime.ownerPrincipalKey,
                ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
                ...(request.waitMs === undefined ? {} : { waitMs: request.waitMs }),
                ...(request.failureTailBytes === undefined ? {} : { failureTailBytes: request.failureTailBytes }),
                ...(request.testFile ? { testFiles: [request.testFile] } : {}),
            });
            const job = result.job;
            results.push({
                index,
                validator: request.validator,
                ...(request.testFile ? { testFile: request.testFile } : {}),
                passed: result.passed,
                completedWithinWait: result.completedWithinWait,
                waitMs: result.waitMs,
                job: {
                    id: job.id,
                    status: job.status,
                    exitCode: job.exitCode,
                    timedOut: job.timedOut,
                    startedAt: new Date(job.startedAt).toISOString(),
                    endedAt: job.endedAt === null ? null : new Date(job.endedAt).toISOString(),
                    durationMs: (job.endedAt ?? Date.now()) - job.startedAt,
                    logFile: job.logFile,
                },
                ...(result.failureOutputTail ? { failureOutputTail: result.failureOutputTail } : {}),
            });
        } catch (error) {
            results.push({
                index,
                validator: request.validator,
                ...(request.testFile ? { testFile: request.testFile } : {}),
                passed: false,
                completedWithinWait: true,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    const failedCount = results.filter((result) => result.passed !== true).length;
    return {
        requestedCount: requests.length,
        ran: true,
        skipped: false,
        skippedReason: null,
        allPassed: failedCount === 0,
        failedCount,
        durationMs: Date.now() - startedAt,
        results,
    };
}
