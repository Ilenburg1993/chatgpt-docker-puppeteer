// @ts-check
/**
 * src/copilot/terminal/commands/tools.js
 *
 * Comando `/tools` do REPL terminal LLM-B.
 *
 * Lista a telemetria canônica das tools/superfícies observadas (invocações, bloqueios, erros, latência).
 *
 * @module copilot/terminal/commands/tools
 * @see EventBus
 */

import {
    compactTerminalDiagnosticId,
    compactTerminalOperatorToolText,
    getTerminalHumanToolName,
} from '../events/tool-activity-presenter.js';
import { readTerminalToolRegistrySnapshot } from '../frontend/gateways/index.js';
import { readTerminalStatusProjection, readTerminalToolStatsProjection } from '../frontend/index.js';
import { terminalThemeHeadline, terminalThemeRow } from '../state/ui/index.js';

/**
 * @typedef {object} ToolsContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * @param {import('../state/tool-lifecycle-state.js').TerminalToolLifecycleDiagnostic} entry
 * @param {{ includeRawDetails?: boolean }} [options]
 * @returns {string}
 */
function renderLifecycleDiagnosticLine(entry, options = {}) {
    const includeRawDetails = options.includeRawDetails === true;
    const refs = renderToolReferenceList([
        ['call', entry.toolCallId, 12],
        ['req', entry.requestId, 12],
        ['trace', entry.traceId, 16],
    ]);
    const target = entry.path ?? entry.target;
    const progress = entry.progress !== null ? ` · ${entry.progress}%` : '';
    const duration = entry.durationMs !== null ? ` · ${Math.max(0, Math.round(entry.durationMs))}ms` : '';
    const visualName = getTerminalHumanToolName(entry.toolName);
    const technicalName = visualName === entry.toolName ? null : entry.toolName;
    const rawName =
        entry.rawToolName && entry.rawToolName !== entry.toolName ? renderSdkRawToolName(entry.rawToolName) : null;
    const operation = entry.operation ? renderLifecycleOperationLabel(entry.operation) : null;
    const status = renderLifecycleStatusLabel(entry.status);
    const summary = [status, operation].filter(Boolean).join(' · ');
    const lines = [
        terminalThemeRow(visualName, `${summary}${progress}${duration}`, {
            role: entry.status === 'failed' ? 'error' : entry.status === 'waiting_user' ? 'question' : 'muted',
            width: 22,
        }),
    ];
    if (target) {
        lines.push(
            terminalThemeRow(renderLifecycleTargetLabel(entry), compactTerminalDiagnosticText(target, 96), {
                role: renderLifecycleTargetRole(entry),
                width: 22,
            }),
        );
    }
    const primaryCommand = entry.commands?.[0] ?? null;
    if (primaryCommand && primaryCommand !== target) {
        lines.push(
            terminalThemeRow('Comando', compactTerminalDiagnosticText(primaryCommand, 120), {
                role: 'tool',
                width: 22,
            }),
        );
    }
    if ((entry.filters?.length ?? 0) > 0) {
        lines.push(
            terminalThemeRow('Filtros', entry.filters.map((filter) => compactTerminalDiagnosticText(filter, 48)).join(' · '), {
                role: 'muted',
                width: 22,
            }),
        );
    }
    if ((entry.directoryTargets?.length ?? 0) > 0) {
        lines.push(
            terminalThemeRow(
                'Diretório',
                entry.directoryTargets
                    .slice(0, 2)
                    .map((directory) => compactTerminalDiagnosticText(directory, 48))
                    .join(' · '),
                { role: 'muted', width: 22 },
            ),
        );
    }
    if (entry.resultSummary) {
        lines.push(
            terminalThemeRow('Resultado', compactTerminalDiagnosticText(entry.resultSummary, 96), {
                role: entry.status === 'failed' ? 'error' : 'success',
                width: 22,
            }),
        );
    }
    if (includeRawDetails && (technicalName || rawName)) {
        lines.push(
            terminalThemeRow('Nome interno', [technicalName, rawName].filter(Boolean).join(' · '), {
                role: 'muted',
                width: 13,
            }),
        );
    }
    if (includeRawDetails && refs) {
        lines.push(terminalThemeRow('Rastreio', refs, { role: 'muted', width: 13 }));
    }
    if (includeRawDetails && typeof entry.updatedAt === 'number') {
        lines.push(terminalThemeRow('Atualizado', new Date(entry.updatedAt).toISOString(), { role: 'muted', width: 13 }));
    }
    return lines.join('\n');
}

/**
 * @param {(text: string) => void} println
 * @param {import('../state/tool-lifecycle-state.js').TerminalToolLifecycleDiagnostic} entry
 * @param {{ includeRawDetails?: boolean }} [options]
 * @returns {void}
 */
function printLifecycleDiagnosticEntry(println, entry, options = {}) {
    for (const line of renderLifecycleDiagnosticLine(entry, options).split('\n')) {
        println(line);
    }
}

/**
 * @param {import('../state/tool-lifecycle-state.js').TerminalToolLifecycleDiagnostic} entry
 * @returns {string}
 */
function renderLifecycleTargetLabel(entry) {
    if (entry.primaryTargetKind === 'command') return 'Comando';
    if (entry.primaryTargetKind === 'directory') return 'Diretório';
    if (entry.primaryTargetKind === 'url') return 'Página';
    if (entry.primaryTargetKind === 'search') return 'Busca';
    if (entry.primaryTargetKind === 'filter') return 'Filtro';
    if (entry.primaryTargetKind === 'patch') return 'Patch';
    return 'Alvo';
}

/**
 * @param {import('../state/tool-lifecycle-state.js').TerminalToolLifecycleDiagnostic} entry
 * @returns {'fileRead' | 'tool' | 'muted'}
 */
function renderLifecycleTargetRole(entry) {
    if (entry.primaryTargetKind === 'file' || entry.primaryTargetKind === 'patch') return 'fileRead';
    if (entry.primaryTargetKind === 'command' || entry.primaryTargetKind === 'url') return 'tool';
    return 'muted';
}

/**
 * @param {string} operation
 * @returns {string}
 */
function renderLifecycleOperationLabel(operation) {
    if (operation === 'io') return 'I/O local';
    if (operation === 'read') return 'leitura';
    if (operation === 'write') return 'escrita';
    if (operation === 'search') return 'busca';
    if (operation === 'mkdir') return 'criação de pasta';
    if (operation === 'edit') return 'edição';
    if (operation === 'move') return 'movimento';
    if (operation === 'copy') return 'cópia';
    if (operation === 'delete') return 'exclusão';
    if (operation === 'ask') return 'pergunta';
    if (operation === 'intent') return 'intenção';
    if (operation === 'inspect') return 'inspeção';
    return operation.replace(/[-_]/gu, ' ');
}

/**
 * @param {string} operation
 * @returns {number}
 */
function fsOperationSortWeight(operation) {
    const order = ['read', 'search', 'patch', 'write', 'copy', 'move', 'delete', 'inspect', 'unknown'];
    const index = order.indexOf(operation);
    return index === -1 ? order.length : index;
}

/**
 * @param {string} operation
 * @param {string} risk
 * @returns {'fileRead' | 'fileWrite' | 'fileEdit' | 'fileDelete' | 'tool' | 'muted'}
 */
function renderFsToolRole(operation, risk) {
    if (operation === 'read' || operation === 'search' || operation === 'inspect') return 'fileRead';
    if (operation === 'patch') return 'fileEdit';
    if (operation === 'delete' || risk === 'destructive') return 'fileDelete';
    if (operation === 'write' || operation === 'copy' || operation === 'move') return 'fileWrite';
    return 'muted';
}

/**
 * @param {Record<string, any>} metadata
 * @returns {string}
 */
function renderFsToolMetadataSummary(metadata) {
    const operation = typeof metadata['operation'] === 'string' ? metadata['operation'] : 'unknown';
    const risk = typeof metadata['risk'] === 'string' ? metadata['risk'] : 'unknown';
    const sideEffect = typeof metadata['sideEffect'] === 'string' ? metadata['sideEffect'] : 'unknown';
    const skip = metadata['effectiveSkipPermission'] === true ? 'autonomia' : 'prompt seletivo';
    const caps = metadata['capabilities'] && typeof metadata['capabilities'] === 'object'
        ? /** @type {Record<string, unknown>} */ (metadata['capabilities'])
        : {};
    const capabilityLabels = [
        caps['dryRun'] === true ? 'dry-run' : null,
        caps['hashPrecondition'] === true ? 'hash' : null,
        caps['pagination'] === true ? 'cursor' : null,
        caps['streaming'] === true ? 'stream' : null,
        caps['diff'] === true ? 'diff' : null,
        caps['rollback'] === true ? 'rollback' : null,
    ].filter(Boolean);
    const details = [
        renderLifecycleOperationLabel(operation),
        `risco ${risk}`,
        sideEffect === 'none' ? 'sem efeito colateral' : `efeito ${sideEffect}`,
        skip,
        capabilityLabels.length > 0 ? `caps ${capabilityLabels.join('/')}` : null,
    ].filter(Boolean);
    return details.join(' · ');
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function printFilesystemToolDiagnostic(println) {
    const snapshot = readTerminalToolRegistrySnapshot();
    const metadataByName = snapshot.metadataByName ?? {};
    const entries = Object.values(metadataByName)
        .filter((metadata) => {
            const m = /** @type {Record<string, any>} */ (metadata);
            const targets = Array.isArray(m['targetKinds']) ? m['targetKinds'] : [];
            const category = typeof m['category'] === 'string' ? m['category'] : '';
            return targets.includes('file') || ['file', 'search', 'index', 'scope'].includes(category);
        })
        .map((metadata) => /** @type {Record<string, any>} */ (metadata))
        .sort((a, b) => {
            const opA = typeof a['operation'] === 'string' ? a['operation'] : 'unknown';
            const opB = typeof b['operation'] === 'string' ? b['operation'] : 'unknown';
            const byOperation = fsOperationSortWeight(opA) - fsOperationSortWeight(opB);
            if (byOperation !== 0) return byOperation;
            return String(a['name'] ?? '').localeCompare(String(b['name'] ?? ''));
        });

    println('');
    println(
        terminalThemeHeadline('fileRead', 'Tools de filesystem', [
            snapshot.hasCanonicalLocalFsTools ? 'FS canônico ativo' : 'FS canônico incompleto',
            `${entries.length} ${entries.length === 1 ? 'tool' : 'tools'}`,
        ]),
    );
    println(
        terminalThemeRow(
            'Fluxo',
            'read/list/search antes de mutar · patch para edição cirúrgica · write/create/delete/move/copy só quando intencional',
            { role: 'muted' },
        ),
    );
    if (entries.length === 0) {
        println(terminalThemeRow('Estado', 'snapshot sem metadata de filesystem; rode /tools contract para contrato completo', { role: 'warn' }));
        return;
    }
    for (const metadata of entries) {
        const name = typeof metadata['name'] === 'string' ? metadata['name'] : '(tool)';
        const operation = typeof metadata['operation'] === 'string' ? metadata['operation'] : 'unknown';
        const risk = typeof metadata['risk'] === 'string' ? metadata['risk'] : 'unknown';
        println(
            terminalThemeRow(getTerminalHumanToolName(name), renderFsToolMetadataSummary(metadata), {
                role: renderFsToolRole(operation, risk),
                width: 24,
            }),
        );
    }
    println(terminalThemeRow('Detalhe', '/tools contract · /tools diag · /fs read <path> · /fs search <pattern>', { role: 'command' }));
}

/**
 * @param {(text: string) => void} println
 * @param {ReturnType<typeof readTerminalToolStatsProjection>} projection
 * @param {{ includeRawDetails?: boolean }} [options]
 * @returns {void}
 */
function printToolFailureDiagnostic(println, projection, options = {}) {
    const problematicEntries = projection.canonicalEntries
        .map(([name, data]) => {
            const d = /** @type {Record<string, any>} */ (data);
            return {
                name,
                calls: Number(d['calls'] ?? 0),
                blocked: Number(d['blocked'] ?? 0),
                errors: Number(d['errors'] ?? 0),
                avgLatencyMs: typeof d['avgLatencyMs'] === 'number' ? d['avgLatencyMs'] : null,
            };
        })
        .filter((entry) => entry.errors > 0 || entry.blocked > 0)
        .sort((a, b) => b.errors + b.blocked - (a.errors + a.blocked) || b.calls - a.calls);
    const failedRecent = (projection.lifecycle?.recent ?? [])
        .filter((entry) => entry.status === 'failed')
        .slice(0, 10);

    println('');
    println(
        terminalThemeHeadline('error', 'Falhas de tools', [
            `${problematicEntries.length} ${problematicEntries.length === 1 ? 'grupo' : 'grupos'}`,
            `${failedRecent.length} ${failedRecent.length === 1 ? 'evento recente' : 'eventos recentes'}`,
        ]),
    );
    if (problematicEntries.length === 0 && failedRecent.length === 0) {
        println(terminalThemeRow('Estado', 'nenhuma falha ou bloqueio observado nesta sessão', { role: 'success' }));
        println(terminalThemeRow('Detalhe', '/tools diag · /events --raw · /errors', { role: 'command' }));
        return;
    }
    for (const entry of problematicEntries.slice(0, 12)) {
        const latency = entry.avgLatencyMs === null ? '?' : `${entry.avgLatencyMs.toFixed(0)}ms`;
        println(
            terminalThemeRow(
                getTerminalHumanToolName(entry.name),
                renderToolStatsSummary(entry.calls, entry.blocked, entry.errors, latency),
                { role: entry.errors > 0 ? 'error' : 'warn', width: 24 },
            ),
        );
    }
    if (failedRecent.length > 0) {
        println(terminalThemeRow('Recentes', countLabel(failedRecent.length, 'falha', 'falhas'), { role: 'muted' }));
        for (const entry of failedRecent) {
            printLifecycleDiagnosticEntry(println, entry, options);
        }
    }
    println(terminalThemeRow('Próximo', '/tools diag para lifecycle completo · /errors para stack/logs · /events --raw para SDK bruto', { role: 'command' }));
}

/**
 * @param {[string, string | null | undefined, number][]} refs
 * @returns {string}
 */
function renderToolReferenceList(refs) {
    return refs
        .map(([label, value, size]) => {
            const compact = compactTerminalDiagnosticId(value, size);
            return compact ? `${label} ${compact}` : null;
        })
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function compactTerminalDiagnosticText(text, max) {
    return compactTerminalOperatorToolText(text, max);
}

/**
 * @param {number} calls
 * @param {number} blocked
 * @param {number} errors
 * @param {string} latency
 * @returns {string}
 */
function renderToolStatsSummary(calls, blocked, errors, latency) {
    return `uso ${calls} · ${blocked > 0 ? countLabel(blocked, 'bloqueio', 'bloqueios') : 'sem bloqueios'} · ${
        errors > 0 ? countLabel(errors, 'falha', 'falhas') : 'sem falhas'
    } · latência ${latency}`;
}

/**
 * @param {number | undefined} calls
 * @param {number | undefined} blocked
 * @param {number | undefined} errors
 * @param {number | undefined} avgLatencyMs
 * @returns {string}
 */
function renderAggregateStatsSummary(calls, blocked, errors, avgLatencyMs) {
    return renderToolStatsSummary(calls ?? 0, blocked ?? 0, errors ?? 0, `${avgLatencyMs ?? 0}ms`);
}

/**
 * @param {Record<string, unknown>} categories
 * @returns {string}
 */
function renderCompactCategorySummary(categories) {
    const entries = Object.entries(categories)
        .map(([category, aggregate]) => {
            const info = /** @type {Record<string, unknown>} */ (aggregate ?? {});
            return {
                category,
                calls: Number(info['totalCalls'] ?? 0),
                errors: Number(info['totalErrors'] ?? 0),
            };
        })
        .filter((entry) => entry.calls > 0)
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 6);
    if (entries.length === 0) return 'sem categorias observadas';
    return entries
        .map((entry) => `${renderCategoryLabel(entry.category)} ${entry.calls}${entry.errors > 0 ? `/${entry.errors} falhas` : ''}`)
        .join(' · ');
}

/**
 * @param {number} count
 * @returns {string}
 */
function renderDisabledToolSummary(count) {
    if (count === 0) return 'nenhuma desabilitada';
    if (count === 1) return '1 desabilitada';
    return `${count} desabilitadas`;
}

/**
 * @param {unknown} record
 * @returns {string | null}
 */
function renderDisabledToolRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const r = /** @type {Record<string, unknown>} */ (record);
    const name = typeof r['name'] === 'string' ? r['name'] : null;
    if (!name) return null;
    const source = r['source'] === 'session' ? 'sessão' : r['source'] === 'runtime' ? 'runtime' : 'origem desconhecida';
    const reason = typeof r['reason'] === 'string' && r['reason'].trim() ? r['reason'].trim() : 'sem motivo registrado';
    const disabledAt = typeof r['disabledAt'] === 'string' && r['disabledAt'].trim() ? r['disabledAt'].trim() : null;
    return `${getTerminalHumanToolName(name)} · ${source} · ${reason}${disabledAt ? ` · ${disabledAt}` : ''}`;
}

/**
 * @param {boolean} active
 * @returns {string}
 */
function renderActiveLabel(active) {
    return active ? 'ativo' : 'ausente';
}

/**
 * @param {boolean} active
 * @returns {'success' | 'warn'}
 */
function renderActiveRole(active) {
    return active ? 'success' : 'warn';
}

/**
 * @param {string} severity
 * @returns {string}
 */
function renderIssueSeverityLabel(severity) {
    if (severity === 'error') return 'Falha';
    if (severity === 'warning' || severity === 'warn') return 'Aviso';
    if (severity === 'decision') return 'Decisão';
    if (severity === 'notice') return 'Nota';
    return 'Nota';
}

/**
 * @param {string} severity
 * @returns {'error' | 'warn' | 'info' | 'question' | 'muted'}
 */
function renderIssueSeverityRole(severity) {
    if (severity === 'error') return 'error';
    if (severity === 'warning' || severity === 'warn') return 'warn';
    if (severity === 'decision') return 'question';
    if (severity === 'notice') return 'info';
    return 'muted';
}

/**
 * @param {Record<string, any>} contract
 * @returns {'success' | 'warn' | 'error' | 'question'}
 */
function renderContractRole(contract) {
    const errors = Number(contract['errorCount'] ?? 0);
    const warnings = Number(contract['warningCount'] ?? 0);
    const decisions = Number(contract['decisionCount'] ?? 0);
    if (errors > 0) return 'error';
    if (warnings > 0) return 'warn';
    if (decisions > 0) return 'question';
    return 'success';
}

/**
 * @param {Record<string, any>} contract
 * @returns {string}
 */
function renderContractStatusSummary(contract) {
    const ok = contract['ok'] !== false;
    const errors = Number(contract['errorCount'] ?? 0);
    const warnings = Number(contract['warningCount'] ?? 0);
    const decisions = Number(contract['decisionCount'] ?? 0);
    const notices = Number(contract['noticeCount'] ?? 0);
    const autonomy = Number(contract['autonomySkipPermissionCount'] ?? 0);
    const permissionMode = typeof contract['permissionMode'] === 'string' ? contract['permissionMode'] : null;
    return [
        ok ? 'ok' : 'atenção',
        `falhas ${errors}`,
        `avisos ${warnings}`,
        decisions > 0 ? `decisões ${decisions}` : null,
        notices > 0 ? `notas ${notices}` : null,
        autonomy > 0 ? `autonomia ${autonomy}` : null,
        permissionMode ? `modo ${permissionMode}` : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, any>} contract
 * @returns {string}
 */
function renderContractRiskSummary(contract) {
    const risky = Number(contract['riskySkipPermissionCount'] ?? 0);
    const autonomy = Number(contract['autonomySkipPermissionCount'] ?? 0);
    const missingInstructions = Number(contract['missingInstructionsCount'] ?? 0);
    const invalidParameters = Number(contract['invalidParametersCount'] ?? 0);
    return [
        risky > 0 ? `skipPermission arriscado ${risky}` : 'sem skipPermission arriscado',
        autonomy > 0 ? `autonomia efetiva ${autonomy}` : 'sem autonomia mutável efetiva',
        invalidParameters > 0 ? `schema inválido ${invalidParameters}` : 'schemas válidos',
        missingInstructions > 0 ? `sem instruções ${missingInstructions}` : 'instruções cobertas',
    ].join(' · ');
}

/**
 * @param {(text: string) => void} println
 * @param {Record<string, any>} contract
 * @param {{ maxIssues?: number; includeCoverage?: boolean; includeRisk?: boolean }} [options]
 * @returns {void}
 */
function printToolContractDiagnostic(println, contract, options = {}) {
    const maxIssues = Math.max(0, Math.floor(options.maxIssues ?? 10));
    println('');
    println(terminalThemeHeadline('tool', 'Contrato das ferramentas'));
    println(terminalThemeRow('Status', renderContractStatusSummary(contract), { role: renderContractRole(contract) }));
    if (options.includeRisk !== false) {
        println(terminalThemeRow('Autonomia', renderContractRiskSummary(contract), { role: renderContractRole(contract) }));
    }
    const coverage = contract['metadataCoverage'];
    if (options.includeCoverage !== false && coverage && typeof coverage === 'object') {
        const c = /** @type {Record<string, unknown>} */ (coverage);
        println(
            terminalThemeRow(
                'Cobertura',
                `descrição ${c['descriptionPct'] ?? '?'}% · schema ${c['parametersPct'] ?? '?'}% · categoria ${c['categoryPct'] ?? '?'}% · tags ${c['tagsPct'] ?? '?'}% · instruções ${c['instructionsPct'] ?? '?'}%`,
            ),
        );
    }
    const issues = Array.isArray(contract['issues']) ? contract['issues'] : [];
    if (issues.length > 0 && maxIssues > 0) {
        const visible = issues.slice(0, maxIssues);
        println(terminalThemeRow('Achados', countLabel(visible.length, 'achado exibido', 'achados exibidos'), { role: 'muted' }));
        for (const issue of visible) {
            const severity = typeof issue?.['severity'] === 'string' ? issue['severity'] : 'notice';
            const code = typeof issue?.['code'] === 'string' ? issue['code'] : 'ISSUE';
            const toolName = typeof issue?.['toolName'] === 'string' ? issue['toolName'] : '(tool)';
            const message = typeof issue?.['message'] === 'string' ? issue['message'] : '';
            println(
                terminalThemeRow(
                    renderIssueSeverityLabel(severity),
                    `${code} · ${renderToolDiagnosticName(toolName)} · ${message}`,
                    { role: renderIssueSeverityRole(severity), width: 8 },
                ),
            );
        }
        if (issues.length > maxIssues) {
            println(terminalThemeRow('Omitidas', countLabel(issues.length - maxIssues, 'achado adicional', 'achados adicionais')));
        }
    }
}

/**
 * @param {string} name
 * @returns {string}
 */
function renderToolDiagnosticName(name) {
    return getTerminalHumanToolName(name);
}

/**
 * @param {string} name
 * @returns {string}
 */
function renderTechnicalToolName(name) {
    return name;
}

/**
 * @param {string} name
 * @returns {string}
 */
function renderSdkRawToolName(name) {
    const visualName = getTerminalHumanToolName(name);
    return visualName === name ? `SDK ${name}` : `SDK ${visualName} (${name})`;
}

/**
 * @param {string} kind
 * @returns {string}
 */
function renderToolKindLabel(kind) {
    if (kind === 'tool') return 'ferramenta';
    if (kind === 'file') return 'arquivo';
    if (kind === 'io') return 'I/O local';
    if (kind === 'shell' || kind === 'exec') return 'terminal';
    if (kind === 'diagnostic') return 'diagnóstico';
    return kind.replace(/[-_]/gu, ' ');
}

/**
 * @param {string} value
 * @returns {string}
 */
function renderCategoryLabel(value) {
    if (value === 'tool') return 'Ferramenta';
    if (value === 'file') return 'Arquivo';
    if (value === 'io') return 'I/O local';
    if (value === 'bridge') return 'Ponte local';
    if (value === 'shell' || value === 'exec') return 'Terminal';
    if (value === 'diagnostic') return 'Diagnóstico';
    if (value === 'sdk') return 'SDK';
    return value.replace(/[-_]/gu, ' ');
}

/**
 * @param {string} visualName
 * @param {string} technicalName
 * @returns {string | null}
 */
function renderToolTechnicalDetail(visualName, technicalName) {
    return visualName === technicalName ? null : renderTechnicalToolName(technicalName);
}

/**
 * @param {boolean} wantsRaw
 * @param {boolean} wantsDiag
 * @param {number} errors
 * @param {number} blocked
 * @returns {'success' | 'warn' | 'error' | 'muted'}
 */
function renderStatsRole(wantsRaw, wantsDiag, errors, blocked) {
    if (errors > 0) return 'error';
    if (blocked > 0) return 'warn';
    return wantsRaw || wantsDiag ? 'muted' : 'success';
}

/**
 * @param {number} active
 * @param {number} waitingUser
 * @param {number} recent
 * @param {number} failedRecent
 * @returns {string}
 */
function renderLifecycleSummary(active, waitingUser, recent, failedRecent) {
    return `ativas ${active} · aguardando operador ${waitingUser} · recentes ${recent} · falhas recentes ${failedRecent}`;
}

/**
 * @param {boolean} wantsRaw
 * @param {boolean} wantsDiag
 * @param {string} visualName
 * @param {number} calls
 * @param {number} blocked
 * @param {number} errors
 * @param {string} latency
 * @returns {string}
 */
function renderToolStatsRow(wantsRaw, wantsDiag, visualName, calls, blocked, errors, latency) {
    return terminalThemeRow(visualName, renderToolStatsSummary(calls, blocked, errors, latency), {
        role: renderStatsRole(wantsRaw, wantsDiag, errors, blocked),
        width: 22,
    });
}

/**
 * @param {string} status
 * @returns {string}
 */
function renderLifecycleStatusLabel(status) {
    if (status === 'io') return 'I/O local';
    if (status === 'running' || status === 'active') return 'em execução';
    if (status === 'completed') return 'concluída';
    if (status === 'failed') return 'falhou';
    if (status === 'waiting-user' || status === 'waiting_user') return 'aguardando operador';
    return status.replace(/[-_]/gu, ' ');
}

/**
 * Comando `/tools`.
 *
 * - Sem argumento: lista tools agregadas por nome canônico.
 * - raw: lista nomes observados brutos (sem agregação canônica).
 * - diag|all: inclui categorias, aliases e diagnóstico de superfícies.
 * - contract: mostra apenas contrato, cobertura e decisões de autonomia.
 *
 * @param {ToolsContext} ctx
 * @param {string} [arg=''] Default is `''`
 * @returns {void}
 */
export function cmdTools({ println }, arg = '') {
    const mode = String(arg || '')
        .trim()
        .toLowerCase();
    const wantsRaw = mode === 'raw';
    const wantsDeepDiag = mode === 'all';
    const wantsContract = mode === 'contract' || mode === 'contracts';
    const wantsFs = mode === 'fs' || mode === 'filesystem' || mode === 'files';
    const wantsFailures = mode === 'failures' || mode === 'failure' || mode === 'failed' || mode === 'errors';
    const wantsDiag = mode === 'diag' || wantsDeepDiag;
    const projection = readTerminalToolStatsProjection();
    const status = readTerminalStatusProjection();
    const entries = wantsRaw ? projection.entries : projection.canonicalEntries;

    if (wantsFs) {
        printFilesystemToolDiagnostic(println);
        println('');
        return;
    }

    if (wantsFailures) {
        printToolFailureDiagnostic(println, projection, { includeRawDetails: wantsDeepDiag });
        println('');
        return;
    }

    if (wantsContract) {
        const detailedContract = readTerminalToolRegistrySnapshot().toolContract;
        printToolContractDiagnostic(println, /** @type {Record<string, any>} */ (detailedContract), { maxIssues: 20 });
        println(terminalThemeRow('Comandos', '/tools diag · /tools all · nomes crus: /tools raw', { role: 'command' }));
        println('');
        return;
    }

    if (entries.length === 0 && !wantsDiag) {
        println('');
        println(terminalThemeRow('Ferramentas', 'Nenhuma ferramenta observada ainda', { role: 'warn' }));
        println(terminalThemeRow('Próximo', 'quando a LLM-B usar arquivos, terminal ou SDK, o resumo aparece aqui'));
        println('');
        return;
    }

    if (wantsRaw || wantsDiag) {
        println('');
        println(
            terminalThemeHeadline('tool', 'Ferramentas', [
                `${entries.length} ${entries.length === 1 ? 'ferramenta' : 'ferramentas'}`,
                wantsRaw ? 'nomes crus' : wantsDeepDiag ? 'diagnóstico completo' : 'diagnóstico humano',
            ]),
        );
        println('');
    } else {
        println('');
        println(terminalThemeHeadline('tool', 'Ferramentas observadas'));
        println(terminalThemeRow('Resumo', `${countLabel(entries.length, 'grupo de ação', 'grupos de ação')} já apareceram nesta sessão`));
        println(terminalThemeRow('Categorias', renderCompactCategorySummary(projection.byCategory ?? {})));
        println('');
    }

    if (entries.length === 0) {
        println('');
        println(terminalThemeHeadline('tool', 'Ferramentas', ['nenhuma observada', wantsDeepDiag ? 'diagnóstico completo' : 'diagnóstico humano']));
        println(terminalThemeRow('Sessão', 'nenhuma tool usada ainda; mostrando contrato e superfícies carregadas', { role: 'muted' }));
    }

    for (const [name, data] of entries) {
        const d = /**
         * @type {{
         *     calls?: number;
         *     errors?: number;
         *     blocked?: number;
         *     avgLatencyMs?: number;
         *     aliases?: string[];
         *     kind?: string;
         * }}
         */ (data);
        const calls = d.calls ?? 0;
        const errors = d.errors ?? 0;
        const blocked = d.blocked ?? 0;
        const latency = typeof d.avgLatencyMs === 'number' ? `${d.avgLatencyMs.toFixed(0)}ms` : '?';
        const visualName = wantsRaw ? name : renderToolDiagnosticName(name);
        println(renderToolStatsRow(wantsRaw, wantsDiag, visualName, calls, blocked, errors, latency));
        const technicalName = renderToolTechnicalDetail(visualName, name);
        if (!wantsRaw && wantsDeepDiag && technicalName) {
            println(terminalThemeRow('Nome interno', technicalName, { role: 'muted', width: 13 }));
        }
        if (!wantsRaw && wantsDeepDiag && Array.isArray(d.aliases) && d.aliases.length > 1) {
            println(terminalThemeRow('Aliases', d.aliases.join(', '), { role: 'muted' }));
        }
        if (wantsDeepDiag && typeof d.kind === 'string' && d.kind.length > 0) {
            println(terminalThemeRow('Tipo', renderToolKindLabel(d.kind), { role: 'muted', width: 22 }));
        }
    }

    if (wantsDiag) {
        const categories = projection.byCategory ?? {};
        const categoryEntries = Object.entries(categories).sort((a, b) => {
            const callsA = Number(/** @type {Record<string, unknown>} */ (a[1])['totalCalls'] ?? 0);
            const callsB = Number(/** @type {Record<string, unknown>} */ (b[1])['totalCalls'] ?? 0);
            return callsB - callsA;
        });
        println('');
        println(terminalThemeHeadline('tool', 'Categorias'));
        for (const [cat, agg] of categoryEntries) {
            const info = /**
             * @type {{
             *     totalCalls?: number;
             *     totalErrors?: number;
             *     totalBlocked?: number;
             *     avgLatencyMs?: number;
             * }}
             */ (agg);
            println(
                terminalThemeRow(
                    renderCategoryLabel(cat),
                    renderAggregateStatsSummary(
                        info.totalCalls,
                        info.totalBlocked,
                        info.totalErrors,
                        info.avgLatencyMs,
                    ),
                    { role: Number(info.totalErrors ?? 0) > 0 ? 'error' : 'muted', width: 22 },
                ),
            );
        }

        const toolLoad = status.toolLoad;
        println('');
        println(terminalThemeHeadline('tool', 'Superfícies operacionais'));
        println(terminalThemeRow('Arquivos locais', renderActiveLabel(toolLoad.hasCanonicalLocalFsTools), { role: renderActiveRole(toolLoad.hasCanonicalLocalFsTools) }));
        println(terminalThemeRow('Terminal local', renderActiveLabel(toolLoad.hasCanonicalLocalExecTools), { role: renderActiveRole(toolLoad.hasCanonicalLocalExecTools) }));
        println(terminalThemeRow('Workspace via SDK', renderActiveLabel(toolLoad.hasSdkWorkspaceTooling), { role: renderActiveRole(toolLoad.hasSdkWorkspaceTooling) }));
        println(terminalThemeRow('Terminal SDK legado', toolLoad.hasLegacySdkShellToolsLoaded ? 'carregado' : 'não carregado', { role: toolLoad.hasLegacySdkShellToolsLoaded ? 'warn' : 'muted' }));
        println(terminalThemeRow('Desabilitadas', renderDisabledToolSummary(toolLoad.disabled.length), { role: toolLoad.disabled.length > 0 ? 'warn' : 'success' }));
        if (toolLoad.disabled.length > 0) {
            const disabledRecords = Array.isArray(toolLoad.disabledRecords)
                ? toolLoad.disabledRecords.map(renderDisabledToolRecord).filter(Boolean)
                : [];
            println(
                terminalThemeRow(
                    'Lista',
                    disabledRecords.length > 0 ? disabledRecords.join(' · ') : toolLoad.disabled.join(', '),
                    { role: 'muted' },
                ),
            );
        }

        const detailedContract = readTerminalToolRegistrySnapshot().toolContract;
        printToolContractDiagnostic(println, /** @type {Record<string, any>} */ (detailedContract), { maxIssues: wantsDeepDiag ? 20 : 10 });

        const lifecycle = projection.lifecycle;
        if (lifecycle) {
            println('');
            println(terminalThemeHeadline('tool', 'Lifecycle recente'));
            println(
                terminalThemeRow(
                    'Resumo',
                    renderLifecycleSummary(
                        lifecycle.summary.active,
                        lifecycle.summary.waitingUser,
                        lifecycle.summary.recent,
                        lifecycle.summary.failedRecent,
                    ),
                    {
                        role: 'muted',
                    },
                ),
            );
            const active = lifecycle.active.slice(0, 8);
            if (active.length > 0) {
                println(terminalThemeRow('Em voo', countLabel(active.length, 'ferramenta', 'ferramentas')));
                for (const entry of active) {
                    printLifecycleDiagnosticEntry(println, entry, { includeRawDetails: wantsDeepDiag });
                }
            }
            if (lifecycle.recent.length > 0) {
                const recentCount = Math.min(8, lifecycle.recent.length);
                println(terminalThemeRow('Recentes', countLabel(recentCount, 'evento', 'eventos')));
                for (const entry of lifecycle.recent.slice(0, 8)) {
                    printLifecycleDiagnosticEntry(println, entry, { includeRawDetails: wantsDeepDiag });
                }
            }
        }
    }

    println(
        wantsRaw || wantsDiag
            ? terminalThemeRow(
                  'Comandos',
                  wantsDeepDiag
                      ? '/tools diag · FS: /tools fs · falhas: /tools failures · contrato: /tools contract · nomes crus: /tools raw'
                      : '/tools all · FS: /tools fs · falhas: /tools failures · contrato: /tools contract · rastreio bruto: /tools raw · /events --raw',
                  { role: 'command' },
              )
            : terminalThemeRow('Detalhes', '/tools fs · /tools failures · /tools diag · contrato: /tools contract · nomes crus: /tools raw', { role: 'command' }),
    );
    println('');
}
