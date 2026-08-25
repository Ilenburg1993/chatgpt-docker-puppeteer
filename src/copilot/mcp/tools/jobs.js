// @ts-check
/**
 * MCP tools for allowlisted Copilot validator jobs.
 *
 * @module copilot/mcp/tools/jobs
 */

import { runBoundedOperationBatch } from '#copilot/infra/public/concurrency/bulk';
import { readMcpProjectDoctor } from '#copilot/mcp/public/diagnostics/project-doctor';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    MCP_TOOL_EXECUTION_LIMITS,
    okResult,
    requireMcpToolGitConfig,
    requireMcpToolValidationConfig,
    requireMcpToolWorkspace,
    withResultExecutionHint,
} from '#copilot/mcp/public/protocol/tools';
import {
    cancelValidationJob,
    executeValidatorRequest,
    listValidationJobs,
    readLastValidationSummary,
    readValidationDashboard,
    readValidationJobOutput,
    readValidationJobSummary,
    startValidatorJobOperation,
} from '#copilot/mcp/public/validation';
import { z } from 'zod';

const validatorSchema = z
    .string()
    .min(1)
    .max(64)
    ['regex'](/^[a-z0-9-]+$/u)
    .describe(
        'Allowlisted validator name. The descriptor intentionally uses a bounded string instead of an enum so newly added fixed validators do not require a host-schema refresh; the server still enforces the current runtime allowlist.',
    );
const focusedTestFileSchema = z
    .string()
    .min(1)
    .max(1024)
    ['describe']('Explicit tests/unit/copilot/**/*.spec.js path for unit-focused.');
const validatorTimeoutMsSchema = z.number().int().min(1000).max(3600000);
const validatorWaitMsSchema = z.number().int().min(0).max(120000);
const validatorFailureTailBytesSchema = z.number().int().min(1000).max(12000);
const validatorRequestSchema = z.object({
    validator: validatorSchema,
    testFile: focusedTestFileSchema.optional(),
    timeoutMs: validatorTimeoutMsSchema.optional(),
    waitForCompletion: z.boolean().optional(),
    waitMs: validatorWaitMsSchema.optional(),
    failureTailBytes: validatorFailureTailBytesSchema.optional(),
});
const {
    maxBatchRequests: MAX_VALIDATOR_BATCH_REQUESTS,
    maxBatchConcurrency: MAX_VALIDATOR_BATCH_CONCURRENCY,
    acceptedInputMaxConcurrency: MAX_VALIDATOR_ACCEPTED_INPUT_CONCURRENCY,
} = MCP_TOOL_EXECUTION_LIMITS.validator;
const safeValidationSuiteSchema = z.enum(['mcp-fast', 'mcp-full', 'copilot-fast']);
const jobStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled']);
/** @type {Record<string, import('#copilot/mcp/public/validation').CopilotValidatorName>} */
const SAFE_VALIDATION_SUITE_TO_VALIDATOR = {
    'mcp-fast': 'suite-mcp-fast',
    'mcp-full': 'suite-mcp-full',
    'copilot-fast': 'suite-copilot-fast',
};

/**
 * Execute one validator request through the canonical job manager. Single-call and batch modes share this exact path.
 *
 * @param {{
 *     validator: string;
 *     testFile?: string;
 *     timeoutMs?: number;
 *     waitForCompletion?: boolean;
 *     waitMs?: number;
 *     failureTailBytes?: number;
 * }} request
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @returns {Promise<import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult>}
 */

/**
 * @param {Awaited<ReturnType<typeof executeValidatorRequest>>} operation
 * @returns {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult}
 */
function frameValidationJobOperation(operation) {
    return operation.ok
        ? okResult(operation.structured, operation.text)
        : errorResult(operation.message, operation.details);
}

/**
 * @param {Awaited<
 *     ReturnType<
 *         typeof runBoundedOperationBatch<
 *             Record<string, unknown>,
 *             import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult
 *         >
 *     >
 * >} execution
 * @param {Record<string, unknown>[]} requests
 */
function compactValidatorBatchResults(execution, requests) {
    return execution.results.map((row) => {
        const request = requests[row.index] ?? {};
        const base = {
            index: row.index,
            validator: request['validator'] ?? null,
            ...(typeof request['testFile'] === 'string' ? { testFile: request['testFile'] } : {}),
            status: row.status,
            durationMs: row.durationMs,
        };
        if (row.status === 'skipped') {
            return { ...base, success: false, skipped: true, code: 'ERR_VALIDATOR_BATCH_SKIPPED', reason: row.reason };
        }
        if ('value' in row && row.value) {
            const structured = row.value.structuredContent ?? {};
            return {
                ...base,
                success: structured['success'] === true,
                ...(structured['completedWithinWait'] === undefined
                    ? {}
                    : { completedWithinWait: structured['completedWithinWait'] }),
                ...(structured['waitMs'] === undefined ? {} : { waitMs: structured['waitMs'] }),
                ...(structured['job'] === undefined ? {} : { job: structured['job'] }),
                ...(structured['failureOutputTail'] === undefined
                    ? {}
                    : { failureOutputTail: structured['failureOutputTail'] }),
                ...(structured['nextAction'] === undefined ? {} : { nextAction: structured['nextAction'] }),
                ...(structured['code'] === undefined ? {} : { code: structured['code'] }),
                ...(structured['error'] === undefined ? {} : { error: structured['error'] }),
                ...(structured['details'] === undefined ? {} : { details: structured['details'] }),
            };
        }
        return {
            ...base,
            success: false,
            code:
                row.status === 'failed'
                    ? (row.code ?? 'ERR_VALIDATOR_BATCH_EXECUTION')
                    : 'ERR_VALIDATOR_BATCH_EXECUTION',
            error:
                row.status === 'failed'
                    ? (row.error ?? 'Validator batch item failed.')
                    : 'Validator batch item failed.',
        };
    });
}

/**
 * @param {import('#copilot/mcp/public/validation').CopilotValidatorName} validator
 * @param {string} name
 * @param {string} title
 * @param {string} description
 * @returns {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
function buildValidatorAliasTool(validator, name, title, description) {
    return defineMcpRawTool({
        name,
        title,
        description,
        inputSchema: {
            timeoutMs: z.number().int().min(1000).max(3600000).optional()['describe']('Timeout ms.'),
        },

        handler: async ({ timeoutMs }, operationContext) =>
            frameValidationJobOperation(
                await startValidatorJobOperation(
                    validator,
                    requireMcpToolWorkspace(operationContext),
                    requireMcpToolValidationConfig(operationContext),
                    { timeoutMs, ...(operationContext?.signal ? { signal: operationContext.signal } : {}) },
                ),
            ),
    });
}

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]}
 */
export const jobTools = [
    buildValidatorAliasTool(
        'typecheck',
        'run_typecheck_copilot',
        'Run Copilot typecheck',
        'Start the canonical strict typecheck job for src/copilot.',
    ),
    buildValidatorAliasTool(
        'lint',
        'run_lint_copilot',
        'Run Copilot lint',
        'Start the canonical lint job for src/copilot and unit tests.',
    ),
    buildValidatorAliasTool(
        'unit-copilot',
        'run_unit_copilot',
        'Run Copilot unit tests',
        'Start the canonical full unit test job for src/copilot.',
    ),
    defineMcpRawTool({
        name: 'mcp_run_safe_validation_suite',
        title: 'Run safe MCP validation suite',
        description: 'Run a fixed broad validation suite. Escalation-only for cross-cutting risk or release gates.',
        inputSchema: {
            suite: safeValidationSuiteSchema['describe']('Broad suite: mcp-fast, mcp-full, or copilot-fast.'),
            timeoutMs: z.number().int().min(1000).max(3600000).optional()['describe']('Timeout ms.'),
        },

        handler: async ({ suite, timeoutMs }, operationContext) => {
            const validator = SAFE_VALIDATION_SUITE_TO_VALIDATOR[String(suite)];
            if (!validator) {
                return errorResult('Unsupported validation suite.', {
                    code: 'ERR_UNSUPPORTED_VALIDATION_SUITE',
                    hint: 'Use mcp-fast, mcp-full, or copilot-fast.',
                    suite,
                });
            }
            return frameValidationJobOperation(
                await startValidatorJobOperation(
                    validator,
                    requireMcpToolWorkspace(operationContext),
                    requireMcpToolValidationConfig(operationContext),
                    { timeoutMs, ...(operationContext?.signal ? { signal: operationContext.signal } : {}) },
                ),
            );
        },
    }),
    defineMcpRawTool({
        name: 'run_project_doctor',
        title: 'Run project doctor',
        description: 'Return the Copilot MCP project doctor report.',
        inputSchema: {
            includeScripts: z.boolean().optional()['describe']('Include scripts. Default: true.'),
        },

        handler: async ({ includeScripts }, operationContext) =>
            okResult(
                await readMcpProjectDoctor(requireMcpToolWorkspace(operationContext), {
                    ...(includeScripts === undefined ? {} : { includeScripts }),
                    gitConfig: requireMcpToolGitConfig(operationContext),
                    ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                }),
            ),
    }),
    defineMcpRawTool({
        name: 'run_copilot_validator',
        title: 'Run Copilot validator',
        description:
            'Run one allowlisted validator or batch up to 8 validator requests in one call. Batch defaults sequential to avoid CPU/memory contention.',
        inputSchema: {
            validator: validatorSchema
                .optional()
                .describe(
                    'Single allowlisted validator name; required outside batch mode. Prefer unit-focused for JS/TS causal gates.',
                ),
            testFile: focusedTestFileSchema.optional(),
            timeoutMs: validatorTimeoutMsSchema.optional()['describe']('Optional validator timeout in ms.'),
            waitForCompletion: z
                .boolean()
                .optional()
                ['describe'](
                    'Wait in this same call. Defaults true for typecheck/lint/unit-focused/devcontainer-shell and false for broad suites.',
                ),
            waitMs: validatorWaitMsSchema
                .optional()
                ['describe']('Bounded completion wait. Default 30000ms when waitForCompletion=true.'),
            failureTailBytes: validatorFailureTailBytesSchema
                .optional()
                ['describe'](
                    'Short log tail returned in the same call only when a waited validator fails. Default 4000.',
                ),
            batch: z
                .array(validatorRequestSchema)
                .min(1)
                .max(MAX_VALIDATOR_BATCH_REQUESTS)
                .optional()
                ['describe']('Batch up to 8 validator requests; do not mix with single-validator fields.'),
            batchFailureMode: z
                .enum(['best-effort', 'fail-fast'])
                .optional()
                ['describe']('Batch failure policy. Default: best-effort.'),
            batchConcurrency: z
                .number()
                .int()
                .min(1)
                .max(MAX_VALIDATOR_ACCEPTED_INPUT_CONCURRENCY)
                .optional()
                ['describe'](
                    'Compatibility input accepts 1-2 for stale clients, but execution is always serialized at 1 to protect WSL/DevContainer headroom.',
                ),
        },

        handler: async (
            {
                validator,
                testFile,
                timeoutMs,
                waitForCompletion,
                waitMs,
                failureTailBytes,
                batch,
                batchFailureMode,
                batchConcurrency,
            },
            operationContext,
        ) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            const validationConfig = requireMcpToolValidationConfig(operationContext);
            if (batch !== undefined) {
                if (
                    validator !== undefined ||
                    testFile !== undefined ||
                    timeoutMs !== undefined ||
                    waitForCompletion !== undefined ||
                    waitMs !== undefined ||
                    failureTailBytes !== undefined
                ) {
                    return errorResult('Do not mix validator batch and single-validator fields.', {
                        code: 'ERR_VALIDATOR_BATCH_CONFLICTING_MODE',
                    });
                }
                try {
                    const requests = /** @type {Record<string, unknown>[]} */ (batch);
                    const execution = await runBoundedOperationBatch(
                        requests,
                        async (raw, index) => {
                            const parsed = validatorRequestSchema.safeParse(raw);
                            if (!parsed.success) {
                                return errorResult(`Invalid validator batch item at index ${index}.`, {
                                    code: 'ERR_VALIDATOR_BATCH_INVALID_ITEM',
                                    index,
                                });
                            }
                            return frameValidationJobOperation(
                                await executeValidatorRequest(
                                    /** @type {Parameters<typeof executeValidatorRequest>[0]} */ (parsed.data),
                                    workspace,
                                    validationConfig,
                                    operationContext?.signal,
                                ),
                            );
                        },
                        {
                            concurrency: MAX_VALIDATOR_BATCH_CONCURRENCY,
                            failureMode: batchFailureMode ?? 'best-effort',
                            maxItems: MAX_VALIDATOR_BATCH_REQUESTS,
                            maxInputBytes: 64 * 1024,
                            estimateItemBytes: (item) => Buffer.byteLength(JSON.stringify(item), 'utf8') + 64,
                            isFailure: (result) =>
                                result.isError === true || result.structuredContent?.['success'] === false,
                        },
                    );
                    const results = compactValidatorBatchResults(execution, requests);
                    const structured = {
                        success: execution.failedCount === 0 && execution.skippedCount === 0,
                        batch: true,
                        executionId: execution.executionId,
                        failureMode: execution.failureMode,
                        requestCount: execution.requestCount,
                        attemptedCount: execution.attemptedCount,
                        succeededCount: execution.succeededCount,
                        failedCount: execution.failedCount,
                        skippedCount: execution.skippedCount,
                        concurrency: execution.concurrency,
                        requestedConcurrency: batchConcurrency ?? 1,
                        effectiveConcurrency: execution.concurrency,
                        compatibilityNormalized:
                            batchConcurrency !== undefined && batchConcurrency !== execution.concurrency,
                        maxInFlight: execution.maxInFlight,
                        durationMs: execution.durationMs,
                        results,
                        nextAction:
                            execution.failedCount > 0
                                ? 'Fix only failed validator items using their included job summary/tail; successful results remain valid.'
                                : execution.skippedCount > 0
                                  ? 'Retry only skipped validator items if they are still required.'
                                  : 'All requested validators completed or started as requested; no status polling is needed for completed items.',
                    };
                    const result = okResult(
                        structured,
                        `Validator batch: ${execution.succeededCount}/${execution.requestCount} succeeded, ${execution.failedCount} failed, ${execution.skippedCount} skipped.`,
                    );
                    return withResultExecutionHint(result, {
                        logicalOperations: execution.requestCount,
                        failedOperations: execution.failedCount,
                        skippedOperations: execution.skippedCount,
                        mode: `validator-batch:${execution.failureMode}:c${execution.concurrency}`,
                    });
                } catch (error) {
                    return errorResult('Validator batch was rejected.', {
                        code:
                            error && typeof error === 'object' && 'code' in error
                                ? /** @type {{ code?: unknown }} */ (error).code
                                : 'ERR_VALIDATOR_BATCH_REJECTED',
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            if (batchFailureMode !== undefined || batchConcurrency !== undefined) {
                return errorResult('batchFailureMode/batchConcurrency require batch mode.', {
                    code: 'ERR_VALIDATOR_BATCH_OPTIONS_WITHOUT_BATCH',
                });
            }
            const parsed = validatorRequestSchema.safeParse({
                validator,
                testFile,
                timeoutMs,
                waitForCompletion,
                waitMs,
                failureTailBytes,
            });
            if (!parsed.success) {
                return errorResult('Single validator request is invalid.', {
                    code: 'ERR_VALIDATOR_REQUEST_INVALID',
                    hint: 'Provide validator, and testFile only when validator=unit-focused.',
                });
            }
            return frameValidationJobOperation(
                await executeValidatorRequest(
                    /** @type {Parameters<typeof executeValidatorRequest>[0]} */ (parsed.data),
                    workspace,
                    validationConfig,
                    operationContext?.signal,
                ),
            );
        },
    }),
    defineMcpRawTool({
        name: 'job_list',
        title: 'List validator jobs',
        description: 'List active and recent validator jobs, including persisted manifests.',
        inputSchema: {
            status: jobStatusSchema.optional()['describe']('Status filter.'),
            validator: validatorSchema.optional().describe('Validator filter.'),
            limit: z.number().int().min(1).max(200).optional()['describe']('Max jobs. Default: 50.'),
            includeCompleted: z.boolean().optional()['describe']('Include finished jobs. Default: true.'),
        },

        handler: async ({ status, validator, limit, includeCompleted }) =>
            frameValidationJobOperation(await listValidationJobs({ status, validator, limit, includeCompleted })),
    }),
    defineMcpRawTool({
        name: 'mcp_last_validation_summary',
        title: 'Last MCP validation summary',
        description: 'Return the latest persisted job per validator without starting validation.',
        inputSchema: {
            validator: validatorSchema.optional().describe('Validator filter.'),
            includeOutputTail: z.boolean().optional()['describe']('Include short log tails. Default: false.'),
            tailBytes: z.number().int().min(1000).max(20000).optional()['describe']('Tail bytes.'),
        },

        handler: async ({ validator, includeOutputTail, tailBytes }) =>
            frameValidationJobOperation(await readLastValidationSummary({ validator, includeOutputTail, tailBytes })),
    }),
    defineMcpRawTool({
        name: 'mcp_validation_dashboard',
        title: 'MCP validation dashboard',
        description: 'Return compact validation status without starting jobs or long logs.',
        inputSchema: {
            includeRunning: z.boolean().optional()['describe']('Include running jobs. Default: true.'),
            includeLatest: z.boolean().optional()['describe']('Include latest jobs. Default: true.'),
            includeDetails: z.boolean().optional()['describe']('Include job arrays. Default: false.'),
            limit: z.number().int().min(10).max(200).optional()['describe']('Max manifests. Default: 80.'),
        },

        handler: async ({ includeRunning, includeLatest, includeDetails, limit }, operationContext) =>
            frameValidationJobOperation(
                await readValidationDashboard(
                    { includeRunning, includeLatest, includeDetails, limit },
                    requireMcpToolValidationConfig(operationContext),
                ),
            ),
    }),
    defineMcpRawTool({
        name: 'job_get_summary',
        title: 'Get job summary',
        description: 'Return compact status for one validator job; no log output.',
        inputSchema: {
            jobId: z.string().min(1)['describe']('Validator job id.'),
        },

        handler: async ({ jobId }) => frameValidationJobOperation(await readValidationJobSummary(jobId)),
    }),
    defineMcpRawTool({
        name: 'job_get_output',
        title: 'Get job output',
        description: 'Read a bounded validator-job log tail and status.',
        inputSchema: {
            jobId: z.string().min(1)['describe']('Validator job id.'),
            tailBytes: z.number().int().min(1000).max(50000).optional()['describe']('Tail bytes. Default: 8000.'),
        },

        handler: async ({ jobId, tailBytes }) =>
            frameValidationJobOperation(await readValidationJobOutput(jobId, tailBytes)),
    }),
    defineMcpRawTool({
        name: 'job_cancel',
        title: 'Cancel job',
        description: 'Cancel an attached running validator job.',
        inputSchema: {
            jobId: z.string().min(1)['describe']('Validator job id.'),
        },

        handler: async ({ jobId }) => frameValidationJobOperation(await cancelValidationJob(jobId)),
    }),
];
