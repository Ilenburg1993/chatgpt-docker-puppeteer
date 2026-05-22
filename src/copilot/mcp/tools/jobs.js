// @ts-check
/**
 * MCP tools for allowlisted Copilot validator jobs.
 *
 * @module copilot/mcp/tools/jobs
 */

import { z } from 'zod';
import { boundedWriteAnnotations, readOnlyAnnotations } from '../control-plane/annotations.js';
import { cancelJob, readJobOutput, spawnValidatorJob } from '../control-plane/jobs.js';
import { errorResult, okResult } from '../control-plane/result.js';
import { projectDoctorTool } from './project-doctor.js';

const validatorSchema = z.enum(['typecheck', 'lint', 'unit-mcp', 'unit-copilot']);

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
