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
    return lines.join('\n');
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
 * @param {number} count
 * @returns {string}
 */
function renderDisabledToolSummary(count) {
    if (count === 0) return 'nenhuma desabilitada';
    if (count === 1) return '1 desabilitada';
    return `${count} desabilitadas`;
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
    return 'Nota';
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
    const wantsDiag = mode === 'diag' || wantsDeepDiag;
    const projection = readTerminalToolStatsProjection();
    const status = readTerminalStatusProjection();
    const entries = wantsRaw ? projection.entries : projection.canonicalEntries;

    if (entries.length === 0) {
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
        println('');
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
        println(terminalThemeRow('Workspace SDK', renderActiveLabel(toolLoad.hasSdkWorkspaceTooling), { role: renderActiveRole(toolLoad.hasSdkWorkspaceTooling) }));
        println(terminalThemeRow('Shell legado', toolLoad.hasLegacySdkShellToolsLoaded ? 'carregado' : 'não carregado', { role: toolLoad.hasLegacySdkShellToolsLoaded ? 'warn' : 'muted' }));
        println(terminalThemeRow('Desabilitadas', renderDisabledToolSummary(toolLoad.disabled.length), { role: toolLoad.disabled.length > 0 ? 'warn' : 'success' }));
        if (toolLoad.disabled.length > 0) {
            println(terminalThemeRow('Lista', toolLoad.disabled.join(', '), { role: 'muted' }));
        }

        const contract = toolLoad.toolContract;
        const contractRole = contract.errorCount > 0 ? 'error' : contract.warningCount > 0 ? 'warn' : 'success';
        println('');
        println(terminalThemeHeadline('tool', 'Contrato das ferramentas'));
        println(
            terminalThemeRow(
                'Status',
                `${contract.ok ? 'ok' : 'atenção'} · falhas ${contract.errorCount} · avisos ${contract.warningCount}`,
                {
                    role: contractRole,
                },
            ),
        );
        println(
            terminalThemeRow(
                'Cobertura',
                `descrição ${contract.metadataCoverage.descriptionPct}% · schema ${contract.metadataCoverage.parametersPct}% · categoria ${contract.metadataCoverage.categoryPct}% · tags ${contract.metadataCoverage.tagsPct}% · instruções ${contract.metadataCoverage.instructionsPct}%`,
            ),
        );
        const detailedContract = readTerminalToolRegistrySnapshot().toolContract;
        if (detailedContract.issues.length > 0) {
            println(
                terminalThemeRow('Achados', countLabel(Math.min(10, detailedContract.issues.length), 'achado exibido', 'achados exibidos'), {
                    role: 'muted',
                }),
            );
            for (const issue of detailedContract.issues.slice(0, 10)) {
                println(
                    terminalThemeRow(
                        renderIssueSeverityLabel(issue.severity),
                        `${issue.code} · ${issue.toolName} · ${issue.message}`,
                        { role: issue.severity === 'error' ? 'error' : 'warn', width: 7 },
                    ),
                );
            }
            if (detailedContract.issues.length > 10) {
                println(terminalThemeRow('Omitidas', countLabel(detailedContract.issues.length - 10, 'achado adicional', 'achados adicionais')));
            }
        }

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
                    println(renderLifecycleDiagnosticLine(entry, { includeRawDetails: wantsDeepDiag }));
                }
            }
            if (lifecycle.recent.length > 0) {
                const recentCount = Math.min(8, lifecycle.recent.length);
                println(terminalThemeRow('Recentes', countLabel(recentCount, 'evento', 'eventos')));
                for (const entry of lifecycle.recent.slice(0, 8)) {
                    println(renderLifecycleDiagnosticLine(entry, { includeRawDetails: wantsDeepDiag }));
                }
            }
        }
    }

    println(
        wantsRaw || wantsDiag
            ? terminalThemeRow(
                  'Comandos',
                  wantsDeepDiag
                      ? '/tools diag · nomes crus: /tools raw'
                      : '/tools all · rastreio bruto: /tools raw · /events --raw',
                  { role: 'command' },
              )
            : terminalThemeRow('Detalhes', '/tools diag · nomes crus: /tools raw', { role: 'command' }),
    );
    println('');
}
