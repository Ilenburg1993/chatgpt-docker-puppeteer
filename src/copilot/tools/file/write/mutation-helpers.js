// @ts-check
/**
 * Helpers compartilhados de mutação para file write tools.
 *
 * @module copilot/tools/file/write/mutation-helpers
 */

import {
    abortIoChangeSet,
    appendIoChangeSetEntry,
    applyIoChangeSet,
    beginIoChangeSet,
    completeIoOperationEnvelope,
    createIoRollbackToken,
    failIoOperationEnvelope,
    getIoRollbackPolicy,
    recordIoMutationAudit,
    serializeIoRollbackToken,
} from '#copilot/infra/public/runtime';
import { toError } from '#copilot/core';
import { createToolFailureResult } from '../../infra/tool-feedback.js';
import {
    buildPatchFailureTerminalSummary,
    patchFailureCategory,
    patchFailureFix,
    readErrorCode,
    readErrorDetails,
} from './patch-feedback.js';

export const ADVISORY_WRITE_CONTENT_BYTES = 2 * 1024 * 1024;
export const ADVISORY_PATCH_SEGMENT_CHARS = 200_000;

/**
 * @typedef {object} RollbackSidecarDescriptor
 * @property {1} version
 * @property {string} path
 * @property {string} contentHash
 * @property {number} bytes
 * @property {number} createdAtMs
 * @property {number} expiresAtMs
 */

/**
 * @param {ReturnType<typeof import('#copilot/infra/public/runtime').createIoOperationEnvelope>} operation
 * @param {{
 *     status?: 'planned' | 'applied' | 'failed' | 'dry-run';
 *     traceId?: string | null;
 *     evidence?: Record<string, unknown>;
 * }} result
 * @param {{
 *     tool: string;
 *     io?: import('#copilot/core/io-contracts').IoMeta | null;
 *     result?: Record<string, unknown>;
 * }} auditContext
 */
export async function completeAndAuditMutation(operation, result, auditContext) {
    const completed = completeIoOperationEnvelope(operation, result);
    const audit = await recordIoMutationAudit(completed, auditContext);
    return audit.enabled
        ? {
              ...completed,
              evidence: { ...completed.evidence, auditLog: audit },
          }
        : completed;
}

/**
 * @param {ReturnType<typeof import('#copilot/infra/public/runtime').createIoOperationEnvelope>} operation
 * @param {unknown} error
 * @param {{
 *     tool: string;
 *     io?: import('#copilot/core/io-contracts').IoMeta | null;
 *     result?: Record<string, unknown>;
 * }} auditContext
 */
export async function failAndAuditMutation(operation, error, auditContext) {
    const failed = failIoOperationEnvelope(operation, error);
    const audit = await recordIoMutationAudit(failed, auditContext);
    return audit.enabled
        ? {
              ...failed,
              evidence: { ...failed.evidence, auditLog: audit },
          }
        : failed;
}

/**
 * @param {{
 *     capability: string;
 *     riskClass: import('#copilot/core/io-contracts').IoRiskClass;
 *     traceId?: string | null;
 *     action?: 'write' | 'patch' | 'delete' | 'copy' | 'move';
 *     targets?: string[];
 *     rollback?: {
 *         action: 'write' | 'patch' | 'delete' | 'copy' | 'move';
 *         target: string;
 *         source?: string | null;
 *         destination?: string | null;
 *         previousHash?: string | null;
 *         contentHash?: string | null;
 *         bytes?: number | null;
 *         snapshotBase64?: string | null;
 *         snapshotSidecar?: RollbackSidecarDescriptor | null;
 *     } | null;
 *     entries?: {
 *         action: 'write' | 'patch' | 'delete' | 'copy' | 'move';
 *         targets: string[];
 *         rollback: {
 *             action: 'write' | 'patch' | 'delete' | 'copy' | 'move';
 *             target: string;
 *             source?: string | null;
 *             destination?: string | null;
 *             previousHash?: string | null;
 *             contentHash?: string | null;
 *             bytes?: number | null;
 *             snapshotBase64?: string | null;
 *             snapshotSidecar?: RollbackSidecarDescriptor | null;
 *         } | null;
 *         evidence?: Record<string, unknown>;
 *     }[];
 *     dryRun?: boolean;
 *     evidence?: Record<string, unknown>;
 * }} input
 */
export function buildMutationChangeSet(input) {
    const rollbackPolicy = getIoRollbackPolicy();
    /**
     * @type {{
     *     action: 'write' | 'patch' | 'delete' | 'copy' | 'move';
     *     targets: string[];
     *     rollback: {
 *         action: 'write' | 'patch' | 'delete' | 'copy' | 'move';
 *         target: string;
 *         source?: string | null;
 *         destination?: string | null;
     *         previousHash?: string | null;
     *         contentHash?: string | null;
     *         bytes?: number | null;
     *         snapshotBase64?: string | null;
     *         snapshotSidecar?: RollbackSidecarDescriptor | null;
     *     } | null;
     *     evidence?: Record<string, unknown>;
     * }[]}
     */
    const entries = [];

    if (Array.isArray(input.entries) && input.entries.length > 0) {
        entries.push(
            ...input.entries.map((entry) => ({
                ...entry,
                rollback: rollbackPolicy.enabled ? entry.rollback ?? null : null,
            })),
        );
    } else if (input.action && Array.isArray(input.targets) && input.targets.length > 0) {
        entries.push({
            action: input.action,
            targets: input.targets,
            rollback: rollbackPolicy.enabled ? input.rollback ?? null : null,
            evidence: { ...(input.evidence ?? {}) },
        });
    }

    let changeSet = beginIoChangeSet({
        capability: input.capability,
        riskClass: input.riskClass,
        targets: entries.flatMap((entry) => entry.targets),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
        evidence: { ...(input.evidence ?? {}) },
    });

    for (const entry of entries) {
        changeSet = appendIoChangeSetEntry(changeSet, {
            action: entry.action,
            targets: entry.targets,
            rollback: entry.rollback ?? null,
            evidence: { ...(entry.evidence ?? input.evidence ?? {}) },
        });
    }

    changeSet = input.dryRun
        ? abortIoChangeSet(changeSet, 'dry-run')
        : applyIoChangeSet(changeSet, {
              ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
              evidence: { ...(input.evidence ?? {}) },
          });

    const rollbackToken = rollbackPolicy.enabled ? createIoRollbackToken(changeSet) : null;
    return {
        id: changeSet.changeSetId,
        status: changeSet.status,
        entryCount: changeSet.entries.length,
        rollback: rollbackToken
            ? {
                  enabled: true,
                  token: serializeIoRollbackToken(rollbackToken),
                  stepCount: rollbackToken.stepCount,
                  steps: rollbackToken.steps,
                  policy: rollbackPolicy,
              }
            : {
                  enabled: false,
                  token: null,
                  stepCount: 0,
                  steps: [],
                  reason: 'disabled_by_default',
                  policy: rollbackPolicy,
              },
    };
}

/**
 * @param {string} reason
 * @returns {import('../../infra/tool-feedback.js').ToolFailureCategory}
 */
function classifyPathFailure(reason) {
    return /vazio|byte nulo|null byte|inválid|invalid|malformad/i.test(reason)
        ? 'invalid-parameters'
        : 'policy-denied';
}

/**
 * @param {string} toolName
 * @param {string} reason
 * @param {Record<string, unknown>} receivedParameters
 * @param {Record<string, unknown>} [details]
 */
export function pathFailureResult(toolName, reason, receivedParameters, details = {}) {
    return createToolFailureResult({
        toolName,
        message: reason,
        category: classifyPathFailure(reason),
        fix: 'Use um caminho válido dentro do workspace e tente novamente.',
        receivedParameters,
        details,
    });
}

/**
 * @param {string} toolName
 * @param {unknown} error
 * @param {Record<string, unknown>} receivedParameters
 * @param {Record<string, unknown>} extraDetails
 * @param {Record<string, unknown>} [extra]
 */
export function mutationFailureResult(toolName, error, receivedParameters, extraDetails, extra = {}) {
    const e = toError(error);
    const code = readErrorCode(error);
    const category = toolName === 'patch_file' ? patchFailureCategory(error) : undefined;
    const fix = toolName === 'patch_file' ? patchFailureFix(error) : undefined;
    const details = {
        ...(code ? { code } : {}),
        ...readErrorDetails(error),
        ...extraDetails,
    };
    const patchTerminalSummary =
        toolName === 'patch_file' ? buildPatchFailureTerminalSummary(code, e.message, details, receivedParameters) : null;
    return createToolFailureResult({
        toolName,
        error,
        ...(category ? { category } : {}),
        ...(fix ? { fix } : {}),
        receivedParameters,
        details,
        extra: {
            ...extra,
            ...(code ? { code } : {}),
            error: e.message,
            ...(patchTerminalSummary
                ? {
                      operationName: 'patch',
                      terminalSummary: patchTerminalSummary,
                      llmNextAction: patchTerminalSummary.nextAction,
                      presentation: {
                          operation: 'patch',
                          path: patchTerminalSummary.path,
                          targetKinds: ['file'],
                          status: 'failed',
                          summary: patchTerminalSummary.summary,
                      },
                  }
                : {}),
        },
    });
}
