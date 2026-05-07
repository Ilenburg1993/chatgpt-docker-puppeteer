// @ts-check
/**
 * @module copilot/terminal/auto-briefing
 * @file Guia operacional canônico para reduzir ambiguidade entre SDK workspace virtual e FS local.
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
 * @property {string} summary
 * @property {string} domainHint
 * @property {string} contextHint
 * @property {string[]} warnings
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
        summary,
        domainHint,
        contextHint:
            'Coleta de contexto: /status -> /sdk doctor -> /tools -> /activity 5 -> /workspace list -> /fs list.',
        warnings,
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
    if (guidance.warnings.length > 0) {
        lines.push(`Atenção: ${guidance.warnings.join('; ')}`);
    }
    return lines;
}
