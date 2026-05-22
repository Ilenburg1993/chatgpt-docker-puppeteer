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

const validatorSchema = z.enum(['typecheck', 'lint', 'unit-mcp', 'unit-copilot']);

/**
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const jobTools = [
    {
        name: 'run_copilot_validator',
        title: 'Run Copilot validator',
        description:
            'Start an allowlisted Copilot validator job. This can run typecheck, lint, focused MCP tests, or the full unit suite.',
        inputSchema: {
            validator: validatorSchema.describe('Validator to run: typecheck, lint, unit-mcp, or unit-copilot.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ validator }) => {
            const job = await spawnValidatorJob(validator);
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
            if (!result.job) return errorResult('Job not found.', { jobId });
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
            if (!result.ok) return errorResult(result.message, { jobId, job: result.job });
            return okResult({ success: true, job: result.job }, result.message);
        },
    },
];

