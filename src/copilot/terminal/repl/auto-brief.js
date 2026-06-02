// @ts-check
/**
 * Auto-brief progressivo do terminal LLM-B.
 *
 * O briefing inicial roda antes do registry de tools estar pronto; por isso ele precisa ser útil mesmo em boot parcial
 * e deve poder rodar de novo após o dialog loop ficar pronto. Este módulo mantém a renderização em uma borda única,
 * sem espalhar heurísticas de UX pelo lifecycle.
 *
 * @module copilot/terminal/repl/auto-brief
 */

import { toError } from '#copilot/core';
import { log } from '#copilot/observability';
import { printlnBlock } from '../dialog/index.js';
import { readTerminalByokProjection, readTerminalStatusProjection } from '../frontend/index.js';
import { buildTerminalOperationalGuidance } from '../frontend/operational-guidance/index.js';
import { readTerminalDisplayState, resolveTerminalBootDisplayPreset } from '../state/repl-runtime/index.js';
import { terminalThemeText } from '../state/repl/index.js';

/** @typedef {'boot' | 'ready' | 'manual'} TerminalAutoBriefPhase */

/** @type {Map<string, string>} */
const _lastAutoBriefFingerprintByPhase = new Map();
const TRANSIENT_BOOT_TOOL_WARNING = 'file-tools canônicas locais não estão totalmente disponíveis';
const AUTO_BRIEF_MODE_FULL = 'full';

/**
 * @param {unknown} value
 * @returns {string}
 */
function yn(value) {
    return value ? 'sim' : 'não';
}

/**
 * @param {boolean} value
 * @returns {string}
 */
function enabledLabel(value) {
    return value ? 'ativo' : 'inativo';
}

/**
 * @param {{ bearerTokenConfigured?: boolean; apiKeyConfigured?: boolean; headersConfigured?: boolean }} auth
 * @returns {string}
 */
function renderAutoBriefAuthLabel(auth) {
    if (auth.bearerTokenConfigured) return 'token bearer';
    if (auth.apiKeyConfigured) return 'chave API';
    if (auth.headersConfigured) return 'headers';
    return 'sem autenticação';
}

/**
 * @param {number | null | undefined} value
 * @returns {string}
 */
function pct(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return `${Math.round(value * 100)}%`;
}

/**
 * @param {ReturnType<typeof readTerminalStatusProjection>['ioRuntime']} ioRuntime
 * @returns {{ io: string; cache: string; index: string }}
 */
function summarizeIoRuntime(ioRuntime) {
    const hitRatio = ioRuntime.cache.aggregate.hitRatio;
    const cache = `acerto ${pct(hitRatio)} · L2 ${yn(Boolean(ioRuntime.cache.l2?.['enabled']))}`;
    const indexRecord = /** @type {Record<string, unknown>} */ (ioRuntime.index ?? {});
    const index = indexRecord['available']
        ? `ok · arquivos ${String(indexRecord['files'] ?? indexRecord['fileCount'] ?? '-')}`
        : `off · ${String(indexRecord['reason'] ?? 'unavailable')}`;
    return {
        io: `escopos ${ioRuntime.scopes.active} · parser ${String(ioRuntime.parser?.size ?? 0)}`,
        cache,
        index,
    };
}

/**
 * @param {string} label
 * @param {string} detail
 * @returns {string}
 */
function briefLine(label, detail) {
    return `${label.padEnd(9)} ${detail}`;
}

/**
 * @param {string[]} warnings
 * @param {{ phase: TerminalAutoBriefPhase; ready: boolean }} context
 * @returns {string[]}
 */
function filterAutoBriefWarnings(warnings, context) {
    if (context.phase !== 'boot' || context.ready) return warnings;
    return warnings.filter((warning) => warning !== TRANSIENT_BOOT_TOOL_WARNING);
}

/**
 * @param {ReturnType<typeof readTerminalStatusProjection>} projection
 * @returns {string}
 */
function buildAutoBriefFingerprint(projection) {
    return [
        projection.runtimeId,
        projection.snap['model'],
        projection.snap['reasoningEffort'],
        projection.snap['isResumed'],
        projection.snap['resumeCount'],
        projection.toolLoad.total,
        projection.toolLoad.hasCanonicalLocalFsTools,
        projection.toolLoad.hasCanonicalLocalExecTools,
        projection.instructionLoad.sectionCount,
        projection.instructionLoad.sectionsMissingFileCount,
        projection.sdkFsRouting.mode,
        projection.timelineSource,
        projection.timelineSyncStatus,
        projection.ioRuntime.cache.aggregate.hitRatio,
        projection.ioRuntime.scopes.active,
        readTerminalByokProjection().summary.enabled,
        readTerminalByokProjection().summary.ready,
        readTerminalByokProjection().summary.model,
    ].join('|');
}

/**
 * @param {{
 *     injectPort?: number;
 *     phase?: TerminalAutoBriefPhase;
 *     runtimeId?: string | null;
 * }} [input]
 * @returns {{
 *     phase: TerminalAutoBriefPhase;
 *     ready: boolean;
 *     fingerprint: string;
 *     lines: string[];
 * }}
 */
export function buildTerminalAutoBrief(input = {}) {
    const phase = input.phase ?? 'boot';
    const projectionArgs = { runtimeId: input.runtimeId ?? null };
    const projection = readTerminalStatusProjection(
        typeof input.injectPort === 'number' ? { ...projectionArgs, injectPort: input.injectPort } : projectionArgs,
    );
    const displayState = readTerminalDisplayState();
    const displayPreset = resolveTerminalBootDisplayPreset();
    const guidance = buildTerminalOperationalGuidance({
        sdkFsRouting: projection.sdkFsRouting,
        toolLoad: projection.toolLoad,
        instructionLoad: projection.instructionLoad,
    });
    const model = typeof projection.snap['model'] === 'string' ? projection.snap['model'] : '-';
    const reasoning = typeof projection.snap['reasoningEffort'] === 'string' ? projection.snap['reasoningEffort'] : '-';
    const contextWindow = projection.snap['contextWindow'];
    const utilization =
        contextWindow && typeof contextWindow === 'object'
            ? /** @type {{ utilization?: number }} */ (contextWindow).utilization
            : null;
    const isResumed = Boolean(projection.snap['isResumed']);
    const resumeCount = Number(projection.snap['resumeCount'] ?? 0);
    const sessionTag = isResumed ? `retomada(#${resumeCount})` : 'nova';
    const ready = projection.toolLoad.total > 0 || projection.dialogLoopActive;
    const io = summarizeIoRuntime(projection.ioRuntime);
    const byok = readTerminalByokProjection().summary;
    /** @type {string[]} */
    const lines = [];
    const visibleWarnings = filterAutoBriefWarnings(guidance.warnings, { phase, ready });
    if (process.env['COPILOT_TERMINAL_AUTO_BRIEF'] !== AUTO_BRIEF_MODE_FULL) {
        const toolBits = [
            `${projection.toolLoad.total} ferramentas`,
            projection.toolLoad.hasCanonicalLocalFsTools ? 'fs' : null,
            projection.toolLoad.hasCanonicalLocalExecTools ? 'exec' : null,
            projection.toolLoad.toolContract.ok ? null : `${projection.toolLoad.toolContract.errorCount} contrato`,
        ].filter(Boolean);
        lines.push(
            briefLine('Sessão', `${model}/${reasoning} · ${sessionTag} · ${displayPreset} · ${toolBits.join(' · ') || 'ferramentas subindo'}`),
        );
        if (byok.enabled) {
            lines.push(
                briefLine(
                    'BYOK',
                    `${byok.ready ? 'pronto' : 'incompleto'} · ${byok.providerType ?? '-'} · ${byok.model ?? '-'} · ${renderAutoBriefAuthLabel(byok.auth)}`,
                ),
            );
        }
        lines.push(briefLine('Fluxo', `${guidance.mode} · próximo ${guidance.nextCommand ?? '/status'}`));
        if (!ready) lines.push(briefLine('Boot', 'parcial · preparando ferramentas/conversa'));
        if (visibleWarnings.length > 0) lines.push(briefLine('Atenção', visibleWarnings.join(' | ')));
        return { phase, ready, fingerprint: buildAutoBriefFingerprint(projection), lines };
    }
    lines.push(`Briefing detalhado (${phase})`);
    lines.push(
        briefLine(
            'Runtime',
            `${projection.runtimeId} · modelo ${model}/${reasoning} · sessão ${sessionTag} · tela ${displayPreset}`,
        ),
    );
    lines.push(
        briefLine(
            'Sinais',
            `raciocínio ${enabledLabel(displayState.thinking)} · resposta ${enabledLabel(displayState.streaming)}`,
        ),
    );
    if (byok.enabled) {
        lines.push(
            briefLine(
                'BYOK',
                `${byok.ready ? 'pronto' : 'incompleto'} · preset ${byok.preset ?? '-'} · provedor ${byok.providerType ?? '-'} · modelo ${byok.model ?? '-'} · autenticação ${renderAutoBriefAuthLabel(byok.auth)}`,
            ),
        );
    }
    lines.push(
        briefLine(
            'Ferram.',
            `${projection.toolLoad.total} · arquivos ${yn(projection.toolLoad.hasCanonicalLocalFsTools)} · terminal ${yn(projection.toolLoad.hasCanonicalLocalExecTools)} · workspace SDK ${yn(projection.toolLoad.hasSdkWorkspaceTooling)} · contrato ${projection.toolLoad.toolContract.ok ? 'ok' : `${projection.toolLoad.toolContract.errorCount} erro(s)`}`,
        ),
    );
    lines.push(
        briefLine('Rota', `${guidance.mode} · ${guidance.summary} · próximo ${guidance.nextCommand ?? '-'}`),
    );
    lines.push(
        briefLine(
            'Timeline',
            `${projection.timelineSource}/${projection.timelineReconciliationStatus} · sync ${projection.timelineSyncStatus}${projection.timelineSyncReason ? `:${projection.timelineSyncReason}` : ''} · turnos ${projection.timelineTurnCount}/${projection.persistedTimelineTurnCount}`,
        ),
    );
    lines.push(
        briefLine('I/O', `${io.io} · cache ${io.cache} · índice ${io.index} · contexto ${pct(utilization)}`),
    );
    if (!ready) {
        lines.push(briefLine('Estado', 'parcial · registry/dialog ainda subindo; novo brief virá com dados reais.'));
    }
    if (visibleWarnings.length > 0) {
        lines.push(briefLine('Atenção', visibleWarnings.join(' | ')));
    }
    return { phase, ready, fingerprint: buildAutoBriefFingerprint(projection), lines };
}

/**
 * @param {{
 *     injectPort?: number;
 *     phase?: TerminalAutoBriefPhase;
 *     runtimeId?: string | null;
 *     force?: boolean;
 *     printlnFn?: (line: string) => void;
 *     printlnBlockFn?: (lines: string[]) => void;
 * }} [input]
 * @returns {ReturnType<typeof buildTerminalAutoBrief> | null}
 */
export function renderTerminalAutoBrief(input = {}) {
    const printlnBlockFn =
        input.printlnBlockFn ?? (input.printlnFn ? (lines) => input.printlnFn?.(lines.join('\n')) : printlnBlock);
    try {
        const brief = buildTerminalAutoBrief(input);
        const dedupeKey = `${brief.phase}:${input.runtimeId ?? 'default'}`;
        if (!input.force && _lastAutoBriefFingerprintByPhase.get(dedupeKey) === brief.fingerprint) {
            return brief;
        }
        _lastAutoBriefFingerprintByPhase.set(dedupeKey, brief.fingerprint);
        printlnBlockFn(brief.lines.map((line) => terminalThemeText('muted', `  ${line}`)));
        return brief;
    } catch (error) {
        log('WARN', `[TerminalServer] Auto-briefing indisponível: ${toError(error).message}`);
        return null;
    }
}

export const __test__ = {
    clear: () => _lastAutoBriefFingerprintByPhase.clear(),
};
