// @ts-check
/**
 * MCP tools for allowlisted Copilot validator jobs.
 *
 * @module copilot/mcp/tools/jobs
 */

import { z } from 'zod';
import { boundedWriteAnnotations, readOnlyAnnotations } from '../control-plane/annotations.js';
import { cancelJob, listJobs, readJobOutput, spawnValidatorJob } from '../control-plane/jobs.js';
import { errorResult, okResult } from '../control-plane/result.js';
import { projectDoctorTool } from './project-doctor.js';

const validatorSchema = z.enum([
    'typecheck',
    'lint',
    'unit-mcp',
    'unit-copilot',
    'suite-mcp-fast',
    'suite-mcp-full',
    'suite-copilot-fast',
]);
const safeValidationSuiteSchema = z.enum(['mcp-fast', 'mcp-full', 'copilot-fast']);
const jobStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled']);

/**
 * @param {Omit<import('../control-plane/jobs.js').JobRecord, 'process'>} job
 * @returns {Record<string, unknown>}
 */
function summarizeJob(job) {
    const durationMs = job.endedAt === null ? Date.now() - job.startedAt : job.endedAt - job.startedAt;
    return {
        id: job.id,
        validator: job.validator,
        status: job.status,
        passed: job.status === 'completed' && job.exitCode === 0,
        running: job.status === 'running',
        startedAt: new Date(job.startedAt).toISOString(),
        endedAt: job.endedAt === null ? null : new Date(job.endedAt).toISOString(),
        durationMs: Math.max(0, durationMs),
        exitCode: job.exitCode,
        signal: job.signal,
        timedOut: job.timedOut,
        commandLine: [job.command, ...job.args].join(' '),
        logFile: job.logFile,
    };
}

/**
 * @param {Omit<import('../control-plane/jobs.js').JobRecord, 'process'>[]} jobs
 * @returns {Record<string, Omit<import('../control-plane/jobs.js').JobRecord, 'process'>>}
 */
function latestJobsByValidator(jobs) {
    /** @type {Record<string, Omit<import('../control-plane/jobs.js').JobRecord, 'process'>>} */
    const latest = {};
    for (const job of jobs) {
        const current = latest[job.validator];
        if (!current || job.startedAt > current.startedAt) latest[job.validator] = job;
    }
    return latest;
}

/** @type {Record<string, import('../control-plane/jobs.js').CopilotValidatorName>} */
const SAFE_VALIDATION_SUITE_TO_VALIDATOR = {
    'mcp-fast': 'suite-mcp-fast',
    'mcp-full': 'suite-mcp-full',
    'copilot-fast': 'suite-copilot-fast',
};

/**
 * @param {import('../control-plane/jobs.js').CopilotValidatorName} validator
 * @param {string} name
 * @param {string} title
 * @param {string} description
 * @returns {import('../registry.js').McpToolDefinition}
 */
function buildValidatorAliasTool(validator, name, title, description) {
    return {
        name,
        title,
        description,
        inputSchema: {
            timeoutMs: z.number().int().min(1000).max(3600000).optional().describe('Optional job timeout in ms.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ timeoutMs }) => {
            const job = await spawnValidatorJob(validator, timeoutMs === undefined ? {} : { timeoutMs });
            return okResult({ success: true, job }, `Started job ${job.id} (${validator}).`);
        },
    };
}

/**
 * @type {import('../registry.js').McpToolDefinition[]}
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
    {
        name: 'mcp_run_safe_validation_suite',
        title: 'Run safe MCP validation suite',
        description:
            'Start a fixed allowlisted validation suite as one job, reducing repeated ChatGPT approval prompts for common verification workflows.',
        inputSchema: {
            suite: safeValidationSuiteSchema.describe(
                'Suite to run: mcp-fast (typecheck + MCP tests), mcp-full (typecheck + lint + MCP tests), or copilot-fast (typecheck + lint + unit-copilot).',
            ),
            timeoutMs: z.number().int().min(1000).max(3600000).optional().describe('Optional job timeout in ms.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ suite, timeoutMs }) => {
            const validator = SAFE_VALIDATION_SUITE_TO_VALIDATOR[String(suite)];
            if (!validator) {
                return errorResult('Unsupported validation suite.', {
                    code: 'ERR_UNSUPPORTED_VALIDATION_SUITE',
                    hint: 'Use mcp-fast, mcp-full, or copilot-fast.',
                    suite,
                });
            }
            const job = await spawnValidatorJob(validator, timeoutMs === undefined ? {} : { timeoutMs });
            return okResult({ success: true, suite, job }, `Started job ${job.id} (${suite}).`);
        },
    },
    {
        name: 'run_project_doctor',
        title: 'Run project doctor',
        description: 'Return the canonical Copilot MCP project doctor report.',
        inputSchema: {
            includeScripts: z.boolean().optional().describe('Include relevant npm scripts. Default: true.'),
        },
        annotations: readOnlyAnnotations(),
        handler: projectDoctorTool.handler,
    },
    {
        name: 'run_copilot_validator',
        title: 'Run Copilot validator',
        description:
            'Start an allowlisted Copilot validator job. This can run typecheck, lint, focused MCP tests, or the full unit suite.',
        inputSchema: {
            validator: validatorSchema.describe('Validator to run: typecheck, lint, unit-mcp, or unit-copilot.'),
            timeoutMs: z.number().int().min(1000).max(3600000).optional().describe('Optional job timeout in ms.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ validator, timeoutMs }) => {
            const job = await spawnValidatorJob(validator, timeoutMs === undefined ? {} : { timeoutMs });
            return okResult({ success: true, job }, `Started job ${job.id} (${validator}).`);
        },
    },
    {
        name: 'job_list',
        title: 'List validator jobs',
        description: 'List active and recent validator jobs, including persisted manifests from previous MCP runs.',
        inputSchema: {
            status: jobStatusSchema.optional().describe('Optional job status filter.'),
            validator: validatorSchema.optional().describe('Optional validator filter.'),
            limit: z.number().int().min(1).max(200).optional().describe('Maximum jobs returned. Default: 50.'),
            includeCompleted: z
                .boolean()
                .optional()
                .describe('Include completed/failed/cancelled jobs. Default: true.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ status, validator, limit, includeCompleted }) => {
            const jobs = await listJobs({ status, validator, limit, includeCompleted });
            return okResult({
                success: true,
                count: jobs.length,
                jobs,
            });
        },
    },
    {
        name: 'mcp_last_validation_summary',
        title: 'Last MCP validation summary',
        description:
            'Return the latest persisted validation job per validator without starting a new validator. Use when ChatGPT host blocks new validation jobs.',
        inputSchema: {
            validator: validatorSchema.optional().describe('Optional validator filter.'),
            includeOutputTail: z
                .boolean()
                .optional()
                .describe('Include a short log tail for each returned job. Default: false.'),
            tailBytes: z
                .number()
                .int()
                .min(1000)
                .max(20000)
                .optional()
                .describe('Output tail bytes when includeOutputTail=true.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ validator, includeOutputTail, tailBytes }) => {
            const jobs = await listJobs({ validator, includeCompleted: true, limit: 200 });
            const latestByValidator = latestJobsByValidator(jobs);
            const selected = validator
                ? Object.values(latestByValidator).filter((job) => job.validator === validator)
                : Object.values(latestByValidator).sort((left, right) => left.validator.localeCompare(right.validator));
            const summaries = [];
            for (const job of selected) {
                const summary = summarizeJob(job);
                if (includeOutputTail === true) {
                    const output = await readJobOutput(job.id, tailBytes ?? 8000);
                    summary['outputTail'] = output.output;
                }
                summaries.push(summary);
            }
            return okResult({
                success: true,
                count: summaries.length,
                validatorsCovered: summaries.map((summary) => summary['validator']),
                summaries,
                hint:
                    summaries.length === 0
                        ? 'No persisted validator jobs found. Run mcp_run_safe_validation_suite or run_copilot_validator when allowed.'
                        : 'Use job_get_output with a specific job id for a longer log tail.',
            });
        },
    },
    {
        name: 'job_get_output',
        title: 'Get job output',
        description: 'Read the tail output and status of a validator job started by run_copilot_validator.',
        inputSchema: {
            jobId: z.string().min(1).describe('Job id returned by run_copilot_validator.'),
            tailBytes: z.number().int().min(1000).max(200000).optional().describe('Maximum bytes from the log tail.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ jobId, tailBytes }) => {
            const result = await readJobOutput(jobId, tailBytes);
            if (!result.job) {
                return errorResult('Job not found.', {
                    code: 'ERR_JOB_NOT_FOUND',
                    hint: 'Use the jobId returned by run_copilot_validator in the current MCP process.',
                    jobId,
                });
            }
            return okResult({ success: true, ...result }, result.output);
        },
    },
    {
        name: 'job_cancel',
        title: 'Cancel job',
        description: 'Cancel a running validator job.',
        inputSchema: {
            jobId: z.string().min(1).describe('Job id returned by run_copilot_validator.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ jobId }) => {
            const result = cancelJob(jobId);
            if (!result.ok) {
                return errorResult(result.message, {
                    code: result.job ? 'ERR_JOB_NOT_RUNNING' : 'ERR_JOB_NOT_FOUND',
                    hint: 'Use job_cancel only for a running job created by run_copilot_validator.',
                    jobId,
                    job: result.job,
                });
            }
            return okResult({ success: true, job: result.job }, result.message);
        },
    },
];
