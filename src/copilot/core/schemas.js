// @ts-check
/**
 * src/copilot/core/schemas.js
 *
 * F94 — Schemas Zod para validação de dados persistidos e payloads HTTP.
 *
 * Centraliza definições de schema para evitar duplicação de lógica de validação manual em cada módulo que faz
 * JSON.parse de arquivos ou payloads. Cada schema é exportado como constante nomeada para uso com `z.safeParse()`.
 *
 * @module copilot/core/schemas
 * @see EventBus
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

// ─── Snapshot (session/state/snapshot.js) ──────────────────────────────────────────

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
        reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
        pendingQuestion: z.string().nullable(),
        pendingQuestionMeta: PendingQuestionMetaSchema.nullable().optional(),
        systemPromptBinding: SystemPromptBindingSnapshotSchema.nullable().optional(),
    })
    .passthrough();

// ─── Ferramentas Customizadas (sdk/custom-tools.js) ──────────────────────────

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

// ─── Estado De Ferramentas (sdk/tools-state.js) ──────────────────────────────

/**
 * Schema para tools-config.json (listas de permissão/negação).
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
 * Schema para a carga útil do endpoint /inject (corpo HTTP parseado).
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

// ─── Contratos De Agente (config/tool-aliases.js + agent/facades/sdk/agent-contract.js) ──

/**
 * Schema para uma configuração de agente customizado (SDK_AGENTS).
 *
 * Usado em validateAgentContracts() para validar estrutura antes de passar ao SDK.
 */
export const SdkCustomAgentConfigSchema = z.object({
    name: z.string().min(1),
    displayName: z.string().optional(),
    description: z.string().min(1),
    tools: z.array(z.string()).min(1).nullable().optional(),
    toolTiers: z
        .object({
            must: z.array(z.string()).optional(),
            should: z.array(z.string()).optional(),
            optional: z.array(z.string()).optional(),
        })
        .optional(),
    prompt: z.string().min(1),
    infer: z.boolean().optional(),
    priority: z.enum(['maestro']).optional(),
});

/**
 * Schema para validação de múltiplos agentes em SessionConfig.customAgents.
 */
export const SessionCustomAgentsSchema = z.array(SdkCustomAgentConfigSchema).min(0);

/**
 * Schema para o resultado de validação de contrato de agente. Usado em agent-contract.js formatValidationResult() e
 * testes.
 */
export const AgentContractValidationResultSchema = z.object({
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    contractLog: z.record(
        z.string(),
        z.object({
            name: z.string(),
            displayName: z.string(),
            toolsRequested: z.array(z.string()),
            toolsResolved: z.array(z.string()),
            unresolvedTools: z.array(z.string()),
            wildcard: z.boolean().optional(),
            status: z.enum(['ok', 'warning', 'error']),
            errors: z.array(z.string()),
            warnings: z.array(z.string()),
        }),
    ),
});
