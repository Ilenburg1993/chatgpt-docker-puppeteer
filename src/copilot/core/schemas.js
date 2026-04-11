// @ts-check
/**
 * src/copilot/core/schemas.js
 *
 * F94 — Schemas Zod para validação de dados persistidos e payloads HTTP.
 *
 * Centraliza definições de schema para evitar duplicação de lógica de validação manual em cada módulo que faz
 * JSON.parse de arquivos ou payloads. Cada schema é exported como constante nomeada para uso com `z.safeParse()`.
 *
 * @module copilot/core/schemas
 * @see EventBus
 */

import { z } from 'zod';

// ─── Snapshot (session/snapshot.js) ──────────────────────────────────────────

/**
 * Schema para itens listados via listSnapshots/listSnapshotsAsync.
 */
export const SnapshotListItemSchema = z.object({
    snapshotId: z.string(),
    createdAt: z.number(),
    sessionId: z.string().nullable().optional(),
    model: z.string().optional(),
    reason: z.string().optional(),
});

/**
 * Schema completo do SessionSnapshotData persistido em disco.
 */
export const SessionSnapshotDataSchema = z.object({
    snapshotId: z.string(),
    createdAt: z.number(),
    sessionId: z.string().nullable(),
    model: z.string(),
    status: z.string(),
    sendCount: z.number(),
    dialogLoopActive: z.boolean(),
    dialogPaused: z.boolean(),
    pendingQuestion: z.string().nullable(),
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

// ─── State-IO (lifecycle/state-io.js) ────────────────────────────────────────

/**
 * Schema para AliveAgentState — estado persistido do agente. Usa passthrough() para não rejeitar campos extras
 * adicionados em versões futuras.
 */
export const AliveAgentStateSchema = z
    .object({
        sessionId: z.string(),
        startedAt: z.number(),
        resumedAt: z.number(),
        resumeCount: z.number(),
        sendCount: z.number(),
        model: z.string(),
        pendingQuestion: z.string().nullable(),
    })
    .passthrough();

// ─── Custom Tools (sdk/custom-tools.js) ──────────────────────────────────────

/**
 * Schema para uma definição de custom tool.
 */
export const CustomToolDefinitionSchema = z.object({
    name: z.string(),
    description: z.string(),
    handlerId: z.string(),
    parameters: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema para o array persistido em custom-tools.json.
 */
export const CustomToolsFileSchema = z.array(CustomToolDefinitionSchema);

// ─── Tools State (sdk/tools-state.js) ────────────────────────────────────────

/**
 * Schema para tools-config.json (allowlist/denylist).
 */
export const ToolsConfigSchema = z.object({
    allowlist: z.array(z.string()).nullable(),
    denylist: z.array(z.string()),
});

// ─── Alias Store (terminal/alias-store.js) ───────────────────────────────────

/**
 * Schema para o arquivo de aliases customizados (Record<string, string>).
 */
export const AliasConfigSchema = z.record(z.string(), z.string());

// ─── Channel Inject (channel/inject.js) ──────────────────────────────────────

/**
 * Schema para o payload do inject /inject endpoint (parsed HTTP body).
 */
export const InjectResponseSchema = z.object({
    ok: z.boolean(),
    reply: z.string().optional(),
    error: z.string().optional(),
});

/**
 * Schema para resposta do /health endpoint.
 */
export const HealthResponseSchema = z.object({
    ok: z.boolean(),
    dialogLoopActive: z.boolean().optional(),
    busy: z.boolean().optional(),
    hubSessionId: z.string().nullable().optional(),
    agentStatus: z.string().optional(),
});
