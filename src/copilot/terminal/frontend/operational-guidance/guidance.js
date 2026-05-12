// @ts-check
/**
 * @module copilot/terminal/frontend/operational-guidance/guidance
 * @file Guia operacional canônico para reduzir ambiguidade entre SDK workspace virtual e FS local.
 *
 *   Corte A.9: expõe `severity` estruturado e `nextCommand` contextual para erros operacionais, permitindo que /fs e
 *   /workspace retornem orientação acionável sem depender de memória implícita.
 */

/**
 * @typedef {object} RoutingSnapshot
 * @property {'local-fs-primary' | 'sdk-workspace-only' | 'degraded'} mode
 * @property {string} reason
 */

/**
 * @typedef {object} ToolLoadSnapshot
 * @property {boolean} hasCanonicalLocalFsTools
 */

/**
 * @typedef {object} InstructionLoadSnapshot
 * @property {number} sectionsMissingFileCount
 * @property {number} appendFileMissingCount
 */

/**
 * @typedef {object} TerminalOperationalGuidance
 * @property {'local-fs-primary' | 'sdk-workspace-only' | 'degraded'} mode
 * @property {'info' | 'warn' | 'error'} severity
 * @property {string} summary
 * @property {string} domainHint
 * @property {string} contextHint
 * @property {string | null} nextCommand
 * @property {string[]} warnings
 */

/**
 * @typedef {{ operation: string; target: string; success: boolean; engine: string | null }} LastIoEntry
 */

/**
 * Constrói guidance operacional para o terminal LLM-B.
 *
 * @param {{
 *     sdkFsRouting: RoutingSnapshot;
 *     toolLoad: ToolLoadSnapshot;
 *     instructionLoad: InstructionLoadSnapshot;
 * }} input
 * @returns {TerminalOperationalGuidance}
 */
export function buildTerminalOperationalGuidance(input) {
    const { sdkFsRouting, toolLoad, instructionLoad } = input;
    const mode = sdkFsRouting.mode;

    /** @type {string} */
    let summary;
    /** @type {string} */
    let domainHint;

    if (mode === 'local-fs-primary') {
        summary = 'FS local canônico é o caminho primário; workspace SDK é auxiliar/virtual.';
        domainHint =
            'Repo real: /fs list|read|search. Virtual: /workspace list|read. Convergir: /workspace sync|mirror|promote.';
    } else if (mode === 'sdk-workspace-only') {
        summary = 'Fallback ativo: operar em workspace SDK até o FS local canônico ser restaurado.';
        domainHint =
            'Trabalhe com /workspace list|read|write e valide /status + /sdk doctor para retorno ao modo canônico.';
    } else {
        summary = 'Modo degradado: superfície de arquivo insuficiente para fluxo seguro.';
        domainHint = 'Regularize boot/load de tools e sessão SDK antes de operar em read/write/search/scan.';
    }

    const warnings = [];
    if (!toolLoad.hasCanonicalLocalFsTools) {
        warnings.push('file-tools canônicas locais não estão totalmente disponíveis');
    }
    if (instructionLoad.sectionsMissingFileCount > 0 || instructionLoad.appendFileMissingCount > 0) {
        warnings.push('há arquivos de instruções ausentes no reload do system prompt');
    }

    return {
        mode,
        severity: mode === 'degraded' ? 'error' : warnings.length > 0 ? 'warn' : 'info',
        summary,
        domainHint,
        contextHint:
            'Coleta de contexto: /status -> /sdk doctor -> /tools -> /activity 5 -> /workspace list -> /fs list.',
        nextCommand:
            mode === 'local-fs-primary'
                ? '/fs list → /activity 5'
                : mode === 'sdk-workspace-only'
                  ? '/workspace list → /sdk doctor'
                  : '/status → /sdk doctor',
        warnings,
    };
}

/**
 * Deriva o próximo comando contextual a partir da última operação de I/O registrada.
 *
 * @param {'local-fs-primary' | 'sdk-workspace-only' | 'degraded'} mode
 * @param {LastIoEntry | null} lastEntry
 * @returns {string}
 */
function deriveNextCommand(mode, lastEntry) {
    if (!lastEntry) {
        if (mode === 'local-fs-primary') return '/activity 5 → /fs list → /status';
        if (mode === 'sdk-workspace-only') return '/workspace list → /sdk doctor';
        return '/status → /sdk doctor → /tools';
    }

    const target = lastEntry.target && lastEntry.target.length > 0 ? ` ${lastEntry.target}` : '';
    const compactTarget = target.length > 60 ? ` ${target.trim().slice(-40)}` : target;

    if (!lastEntry.success) {
        if (lastEntry.operation === 'read') return `/status → /fs read${compactTarget}`;
        if (lastEntry.operation === 'write') return `/status → /fs write${compactTarget} <conteúdo>`;
        if (lastEntry.operation === 'scan' || lastEntry.operation === 'list')
            return `/status → /fs list${compactTarget}`;
        if (lastEntry.operation === 'search') return `/status → /fs search <padrão>`;
        if (lastEntry.operation === 'fetch') return `/status → /workspace list`;
        if (lastEntry.operation === 'delete') return `/status → /fs list`;
        return '/activity 5 → /status';
    }

    // Última operação bem-sucedida — sugerir próxima ação natural
    if (lastEntry.operation === 'read') return '/activity 5';
    if (lastEntry.operation === 'write') return `/fs read${compactTarget}`;
    if (lastEntry.operation === 'scan') return `/fs read <arquivo>`;
    if (lastEntry.operation === 'search') return `/fs read <arquivo encontrado>`;
    if (lastEntry.operation === 'fetch') return '/workspace list';
    return '/activity 5';
}

/**
 * Constrói guidance orientado pelo estado de atividade atual da sessão.
 *
 * Diferente de `buildTerminalOperationalGuidance`, que usa apenas o modo de roteamento, esta função aceita a última
 * entrada de I/O para derivar um `nextCommand` contextual específico, útil para exibição nos handlers de erro de `/fs`
 * e `/workspace`.
 *
 * @param {{
 *     mode: 'local-fs-primary' | 'sdk-workspace-only' | 'degraded';
 *     warnings?: string[];
 *     lastIoEntry?: LastIoEntry | null;
 * }} options
 * @returns {TerminalOperationalGuidance}
 */
export function buildActivityAwareGuidance(options) {
    const { mode, warnings: extraWarnings = [], lastIoEntry = null } = options;

    const base = buildTerminalOperationalGuidance({
        sdkFsRouting: { mode, reason: '' },
        toolLoad: { hasCanonicalLocalFsTools: mode !== 'degraded' },
        instructionLoad: { sectionsMissingFileCount: 0, appendFileMissingCount: 0 },
    });

    const nextCommand = deriveNextCommand(mode, lastIoEntry ?? null);
    const allWarnings = [...base.warnings, ...extraWarnings];
    const severity = mode === 'degraded' ? 'error' : allWarnings.length > 0 ? 'warn' : 'info';

    return {
        ...base,
        severity,
        nextCommand,
        warnings: allWarnings,
    };
}

/**
 * Renderiza linhas canônicas de recuperação operacional para falhas em comandos.
 *
 * @param {ReturnType<typeof buildTerminalOperationalGuidance>} guidance
 * @returns {string[]}
 */
export function buildFailureRecoveryLines(guidance) {
    /** @type {string[]} */
    const lines = [`Próximos passos: ${guidance.contextHint}`];
    if (guidance.mode === 'local-fs-primary') {
        lines.push('Domínio ativo: FS local canônico (/fs). Use /workspace apenas para contexto virtual.');
    } else if (guidance.mode === 'sdk-workspace-only') {
        lines.push(
            'Domínio ativo: workspace SDK virtual. Convirja com /workspace sync|mirror|promote conforme direção.',
        );
    }
    if (guidance.nextCommand) {
        lines.push(`Próximo: ${guidance.nextCommand}`);
    }
    if (guidance.warnings.length > 0) {
        lines.push(`Atenção: ${guidance.warnings.join('; ')}`);
    }
    return lines;
}
