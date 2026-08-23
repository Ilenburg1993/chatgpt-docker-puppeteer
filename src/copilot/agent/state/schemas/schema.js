// @ts-check
/**
 * Canonical persisted-state schemas for the Agent domain.
 *
 * These schemas belong to the state they validate; they are not cross-domain Core contracts.
 * @module copilot/agent/state/schemas/schema
 */

import { z } from 'zod';

export const PendingQuestionMetaSchema = z.object({
    kind: z.enum(['ready', 'reply', 'stopped', 'question']),
    askedAt: z.number(),
    allowFreeform: z.boolean(),
    protocolControlled: z.boolean(),
    choices: z.array(z.string()).optional(),
});

export const PendingQuestionShadowSchema = z.object({
    question: z.string(),
    meta: PendingQuestionMetaSchema,
    restoredAt: z.number(),
    expiresAt: z.number(),
});

export const SystemPromptBindingSnapshotSchema = z.object({
    sessionId: z.string().nullable(),
    digest: z.string(),
    configuredMode: z.enum(['append', 'customize', 'replace']),
    effectiveMode: z.enum(['append', 'customize', 'replace']),
    effectiveLiveMode: z.enum(['append', 'customize', 'replace']),
    liveReloadEnabled: z.boolean(),
    liveReloadMechanism: z.enum(['sdk-transform', 'static-snapshot']),
    reloadStrategy: z.enum(['sdk-transform', 'static']),
    boundAt: z.number(),
});

export const SnapshotIdSchema = z
    .string()
    .min(1)
    .max(128)
    ['regex'](/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u, 'snapshotId must be a safe file basename');

export const SnapshotListItemSchema = z.object({
    snapshotId: SnapshotIdSchema,
    createdAt: z.number(),
    sessionId: z.string().nullable().optional(),
    model: z.string().optional(),
    reason: z.string().optional(),
});

export const SessionSnapshotDataSchema = z.object({
    snapshotId: SnapshotIdSchema,
    createdAt: z.number(),
    sessionId: z.string().nullable(),
    model: z.string(),
    status: z.string(),
    sendCount: z.number(),
    dialogLoopActive: z.boolean(),
    dialogPaused: z.boolean(),
    pendingQuestion: z.string().nullable(),
    pendingQuestionMeta: PendingQuestionMetaSchema.nullable().optional(),
    pendingQuestionShadow: PendingQuestionShadowSchema.nullable().optional(),
    stateSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    prMetrics: z
        .object({
            boots: z.number(),
            resumesWithPR: z.number(),
            resumesZeroPR: z.number(),
            totalPR: z.number(),
        })
        .nullable()
        .optional(),
    reason: z.string().optional(),
});

export const AliveAgentStateSchema = z
    .object({
        sessionId: z.string(),
        startedAt: z.number(),
        resumedAt: z.number(),
        resumeCount: z.number(),
        sendCount: z.number(),
        model: z.string(),
        reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
        pendingQuestion: z.string().nullable(),
        pendingQuestionMeta: PendingQuestionMetaSchema.nullable().optional(),
        systemPromptBinding: SystemPromptBindingSnapshotSchema.nullable().optional(),
    })
    ['passthrough']();
