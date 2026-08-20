// @ts-check
/**
 * MCP surface for sanitized client TTFT evidence.
 *
 * @module copilot/mcp/tools/client-latency-evidence
 */

import {
    appendClientLatencyEvidence,
    boundedWriteAnnotations,
    errorResult,
    okResult,
    readClientLatencyEvidence,
    summarizeClientLatencyEvidence,
} from '#copilot/mcp/control-plane';
import { z } from 'zod';

const labelSchema = z
    .string()
    .min(1)
    .max(64)
    ['regex'](/^[A-Za-z0-9._:-]+$/u);

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpClientLatencyEvidenceTool = {
    name: 'mcp_client_latency_evidence',
    title: 'Client TTFT evidence',
    description:
        'Record or summarize sanitized client-observed ChatGPT latency evidence such as submit-to-first-token TTFT. Stores timings and closed experiment labels only; never prompts, completions, HAR bodies, URLs, IPs, cookies or tokens.',
    inputSchema: {
        action: z.enum(['record', 'summary']).optional()['describe']('Default: summary.'),
        source: z
            .enum(['manual', 'har', 'client-observer'])
            .optional()
            ['describe']('Evidence source; required for record.'),
        observedAt: z
            .string()
            ['datetime']()
            .optional()
            .describe('Client observation timestamp. Defaults to record time.'),
        ttftMs: z
            .number()
            .min(0)
            .max(600_000)
            .optional()
            ['describe']('User submit -> first rendered/streamed assistant token. Required for record.'),
        firstToolDispatchMs: z
            .number()
            .min(0)
            .max(600_000)
            .optional()
            ['describe']('Optional client-observed submit -> first tool dispatch milestone.'),
        turnCompleteMs: z
            .number()
            .min(0)
            .max(600_000)
            .optional()
            ['describe']('Optional user submit -> completed assistant turn.'),
        thinkingMode: z.enum(['low', 'medium', 'high', 'unknown']).optional(),
        modelLabel: labelSchema.optional(),
        networkLabel: labelSchema.optional(),
        conversationLabel: labelSchema.optional(),
        clientLabel: labelSchema.optional(),
        vpnLabel: labelSchema.optional(),
        seriesId: labelSchema.optional(),
        historyLimit: z
            .number()
            .int()
            .min(1)
            .max(5_000)
            .optional()
            ['describe']('Evidence entries read for summary. Default: 500.'),
        maxEntries: z
            .number()
            .int()
            .min(1)
            .max(20_000)
            .optional()
            ['describe']('Retention cap when recording. Default: 2000.'),
        includeEntries: z
            .boolean()
            .optional()
            ['describe']('Include raw sanitized evidence rows in summary. Default: false.'),
    },
    annotations: boundedWriteAnnotations(),
    handler: async ({
        action,
        source,
        observedAt,
        ttftMs,
        firstToolDispatchMs,
        turnCompleteMs,
        thinkingMode,
        modelLabel,
        networkLabel,
        conversationLabel,
        clientLabel,
        vpnLabel,
        seriesId,
        historyLimit,
        maxEntries,
        includeEntries,
    } = {}) => {
        const effectiveAction = action ?? 'summary';
        let recorded = null;
        if (effectiveAction === 'record') {
            if (source === undefined || ttftMs === undefined) {
                return errorResult('record requires source and ttftMs.', {
                    code: 'ERR_CLIENT_LATENCY_EVIDENCE_REQUIRED_FIELDS',
                    required: ['source', 'ttftMs'],
                });
            }
            recorded = await appendClientLatencyEvidence(
                {
                    source,
                    ttftMs,
                    observedAt,
                    firstToolDispatchMs,
                    turnCompleteMs,
                    thinkingMode,
                    modelLabel,
                    networkLabel,
                    conversationLabel,
                    clientLabel,
                    vpnLabel,
                    seriesId,
                },
                { maxEntries },
            );
        }
        const history = await readClientLatencyEvidence({ limit: historyLimit });
        const summary = summarizeClientLatencyEvidence(history.entries);
        return okResult({
            success: history.ok,
            action: effectiveAction,
            authority: 'client-provided-sanitized-latency-evidence',
            recorded,
            history: {
                ok: history.ok,
                path: history.path,
                entriesRead: history.entries.length,
                truncatedByBytes: history.truncatedByBytes,
                ...(history.error ? { error: history.error } : {}),
            },
            summary,
            ttftSemantics: {
                chatgptUiTtft:
                    'Client submit -> first rendered/streamed assistant token; this is the TTFT field stored here.',
                endpointTtfb:
                    'Separate metric: DevContainer request -> first HTTP response headers from a fixed OpenAI/ChatGPT endpoint.',
                mcpPreDispatch:
                    'Separate metric: previous MCP response finish -> first discrete initialize/next-call work reaches the MCP origin.',
                apiStreamingTtft:
                    'Separate metric requiring an explicit authenticated streaming model request; not inferred from client TTFT.',
            },
            ...(includeEntries === true ? { entries: history.entries } : {}),
        });
    },
};
