// @ts-check
import { setTimeout as sleep } from 'node:timers/promises';
import { buildContextPack } from './triage/context_pack.mjs';
import { buildProposalV3 } from './triage/proposal_engine_v3.mjs';
import { rankRootCauses } from './triage/root_cause_ranker.mjs';
import { buildTestPlan } from './triage/test_planner.mjs';

/**
 * @import {AuditFindingV3} from "./lib/schema.mjs"
 */

const MCP_URL = process.env.MCP_DIAG_URL ? `${process.env.MCP_DIAG_URL}/api/mcp` : 'http://localhost:3008/api/mcp';

/** @typedef {Record<string, any>} CallMcpParams */
/**
 * @param {string} method
 * @param {CallMcpParams} params
 * @param {number} id
 * @returns {Promise<any | null>}
 */
async function callMcp(method, params, id) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
        const res = await fetch(MCP_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
            signal: ctrl.signal,
        });

        if (!res.ok) {
            return null;
        }

        return await res.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * @typedef {object} DeterministicFallbackOptions
 * @property {boolean | undefined} [proposeDiffs]
 * @property {'basic' | 'standard' | 'deep' | undefined} [proposalDepth]
 * @property {string | undefined} [masterPath]
 */
/**
 * @param {AuditFindingV3} finding
 * @param {DeterministicFallbackOptions} options
 */
function deterministicFallback(finding, options) {
    if (!finding.proposal || typeof finding.proposal !== 'object') {
        finding.proposal = {
            summary: null,
            suggested_diff: null,
            files_touched: finding.file ? [finding.file] : [],
            test_plan: [],
            rollback_hint: null,
            depth: 'standard',
            validation_commands: [],
        };
    }

    if (!finding.impact) {
        finding.impact =
            finding.severity === 'P0' || finding.severity === 'P1'
                ? 'Risco direto de indisponibilidade/regressão em runtime crítico.'
                : 'Risco de degradação de qualidade e manutenção do código.';
    }

    if (!finding.root_cause) {
        if (finding.source_tool.includes('check:forbidden')) {
            finding.root_cause = 'Violação de política arquitetural detectada por regra proibida.';
        } else if (finding.source_tool.includes('typecheck')) {
            finding.root_cause = 'Inconsistência de tipos detectada em análise estática.';
        } else if (finding.source_tool.includes('mcp:diagnose') || finding.source_tool.includes('rag:health')) {
            finding.root_cause = 'Infra de contexto (MCP/RAG/LSP) indisponível ou degradada.';
        } else if (finding.source_tool.includes('test')) {
            finding.root_cause = 'Comportamento divergente detectado por teste automatizado.';
        } else {
            finding.root_cause = 'Problema detectado por coleta automatizada sem contexto adicional.';
        }
    }

    if (!finding.suggested_patch) {
        finding.suggested_patch =
            'Aplicar correção localizada no arquivo/regra apontado e validar com runner de auditoria.';
    }

    if (!finding.test_strategy) {
        finding.test_strategy = 'Reexecutar `npm run audit:quick` e a suite específica da área impactada.';
    }

    if (!finding.regression_risk) {
        finding.regression_risk = finding.severity === 'P0' || finding.severity === 'P1' ? 'Alto' : 'Médio';
    }

    if (typeof finding.confidence_score !== 'number') {
        finding.confidence_score = 0.45;
    }
    if (!Array.isArray(finding.root_cause_candidates)) {
        finding.root_cause_candidates = [];
    }
    if (!finding.enforcement_state) {
        finding.enforcement_state = 'warn';
    }

    const contextPack = buildContextPack(finding, {
        rag: null,
        lsp: null,
        masterPath: options.masterPath,
    });
    const ranked = rankRootCauses(contextPack);
    const enriched = buildProposalV3(finding, {
        rankedCauses: ranked,
        proposeDiffs: options.proposeDiffs,
        depth: options.proposalDepth,
        contextPack,
    });

    finding.root_cause = finding.root_cause || enriched.root_cause;
    finding.root_cause_candidates = enriched.root_cause_candidates;
    finding.confidence_score = Math.max(Number(finding.confidence_score || 0), Number(enriched.confidence_score || 0));
    finding.proposal.depth = enriched.proposal.depth;
    finding.proposal.summary =
        enriched.proposal.summary || finding.proposal.summary || 'Correção local orientada por evidência automatizada.';
    finding.proposal.suggested_diff = enriched.proposal.suggested_diff || finding.proposal.suggested_diff;
    finding.proposal.files_touched = enriched.proposal.files_touched || finding.proposal.files_touched;
    finding.proposal.test_plan =
        Array.isArray(enriched.proposal.test_plan) && enriched.proposal.test_plan.length > 0
            ? enriched.proposal.test_plan
            : buildTestPlan(finding);
    finding.proposal.rollback_hint = enriched.proposal.rollback_hint || finding.proposal.rollback_hint;
    finding.proposal.validation_commands =
        Array.isArray(enriched.proposal.validation_commands) && enriched.proposal.validation_commands.length > 0
            ? enriched.proposal.validation_commands
            : ['npm run audit:quick -- --focus bug-first'];
    finding.proposal_context = enriched.proposal_context || {
        code_context_used: false,
        rag_scope: null,
        lsp_signal_quality: finding.source_tool.includes('lsp') ? 'medium' : 'low',
    };
}

/**
 * @typedef {object} TriageFindingsOptions
 * @property {boolean} [enabled]
 * @property {number} [maxMcpFindings]
 * @property {boolean} [proposeDiffs]
 * @property {'bug-first' | 'all'} [focusMode]
 * @property {'basic' | 'standard' | 'deep'} [proposalDepth]
 * @property {'off' | 'on'} [cloudFallback]
 * @property {string} [masterPath]
 * @property {number} [maxDurationMs]
 * @property {(payload: any) => void} [onProgress]
 * @property {string | null} [findingId]
 */
/**
 * @param {AuditFindingV3[]} findings
 * @param {TriageFindingsOptions} [options]
 * @returns {Promise<{ findings: AuditFindingV3[]; usedMcp: boolean; degraded: boolean; warnings: string[] }>}
 */
export async function triageFindings(findings, options = {}) {
    const enabled = options.enabled !== false;
    const maxMcpFindings = Number.isFinite(options.maxMcpFindings) ? Number(options.maxMcpFindings) : 80;
    const proposeDiffs = options.proposeDiffs === true;
    const focusMode = options.focusMode === 'all' ? 'all' : 'bug-first';
    const proposalDepth = ['basic', 'standard', 'deep'].includes(options.proposalDepth || '')
        ? options.proposalDepth
        : 'standard';
    const cloudFallback = options.cloudFallback === 'on' ? 'on' : 'off';
    const maxDurationMs = Number.isFinite(options.maxDurationMs) ? Number(options.maxDurationMs) : 0;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const startedAt = Date.now();

    /** @type {string[]} */
    const warnings = [];

    if (!enabled || findings.length === 0) {
        const enriched = findings.map((finding) => {
            const working = { ...finding };
            deterministicFallback(working, {
                proposeDiffs,
                proposalDepth,
                masterPath: options.masterPath,
            });
            return working;
        });
        if (onProgress) {
            onProgress({
                phase: 'triage-intelligence',
                processed: enriched.length,
                total: findings.length,
                percent: findings.length > 0 ? 100 : 0,
                mode: 'disabled',
                findingId: null,
            });
        }
        return { findings: enriched, usedMcp: false, degraded: true, warnings };
    }

    const ping = await callMcp('ping', {}, 1);
    const mcpAvailable = Boolean(ping && !ping.error);

    if (!mcpAvailable) {
        warnings.push('MCP unavailable for LLM triage; deterministic fallback used.');
        if (cloudFallback === 'on') {
            warnings.push(
                'cloud-fallback=on configurado, mas fallback cloud não foi executado (sem cliente remoto configurado).',
            );
        }
        const enriched = findings.map((finding) => {
            const working = { ...finding };
            deterministicFallback(working, {
                proposeDiffs,
                proposalDepth,
                masterPath: options.masterPath,
            });
            return working;
        });
        if (onProgress) {
            onProgress({
                phase: 'triage-intelligence',
                processed: enriched.length,
                total: findings.length,
                percent: findings.length > 0 ? 100 : 0,
                mode: 'fallback',
                findingId: null,
            });
        }
        return { findings: enriched, usedMcp: false, degraded: true, warnings };
    }

    let requestId = 10;
    /** @type {AuditFindingV3[]} */
    const enriched = [];
    let timedOut = false;

    for (let index = 0; index < findings.length; index += 1) {
        if (maxDurationMs > 0 && Date.now() - startedAt >= maxDurationMs) {
            timedOut = true;
            warnings.push(
                `Triage timeout atingido (${maxDurationMs}ms); fallback determinístico aplicado no restante.`,
            );
            for (let rest = index; rest < findings.length; rest += 1) {
                const pending = { .../** @type {any} */ (findings[rest]) };
                deterministicFallback(pending, {
                    proposeDiffs,
                    proposalDepth,
                    masterPath: options.masterPath,
                });
                const criticalType =
                    pending.type === 'bug' || pending.type === 'gap' || pending.type === 'falha de contrato';
                const criticalSeverity = pending.severity === 'P0' || pending.severity === 'P1';
                pending.finding_channel =
                    focusMode === 'bug-first'
                        ? criticalType && criticalSeverity
                            ? 'primary'
                            : 'backlog'
                        : pending.finding_channel || 'primary';
                enriched.push(pending);
                if (onProgress) {
                    const processed = enriched.length;
                    const total = findings.length;
                    const percent = total > 0 ? Number(((processed / total) * 100).toFixed(2)) : 100;
                    onProgress({
                        phase: 'triage-intelligence',
                        processed,
                        total,
                        percent,
                        mode: 'timeout',
                        findingId: pending.id || null,
                    });
                }
            }
            break;
        }

        const finding = /** @type {any} */ (findings[index]);
        const working = {
            ...finding,
            proposal: {
                depth: finding.proposal?.depth || 'standard',
                summary: finding.proposal?.summary || null,
                suggested_diff: finding.proposal?.suggested_diff || null,
                files_touched: Array.isArray(finding.proposal?.files_touched)
                    ? [...finding.proposal.files_touched]
                    : [],
                test_plan: Array.isArray(finding.proposal?.test_plan) ? [...finding.proposal.test_plan] : [],
                rollback_hint: finding.proposal?.rollback_hint || null,
                validation_commands: Array.isArray(finding.proposal?.validation_commands)
                    ? [...finding.proposal.validation_commands]
                    : [],
            },
        };

        try {
            let ragData = null;
            let lspData = null;

            if (index < maxMcpFindings) {
                const query = [working.file, working.evidence, working.source_tool].filter(Boolean).join(' | ');
                const extMatch = working.file ? working.file.match(/(\.[a-zA-Z0-9]+)$/) : null;
                const pathPrefix = working.file
                    ? String(working.file).replace(/\\/g, '/').split('/').slice(0, -1).join('/')
                    : undefined;
                const ragSearch = await callMcp(
                    'tools/call',
                    {
                        name: 'rag_search',
                        arguments: {
                            query: query.slice(0, 300),
                            topK: 3,
                            profile: 'core',
                            mode: 'auto',
                            includeDiagnostics: true,
                            pathPrefix: pathPrefix || undefined,
                            ext: extMatch ? extMatch[1] : undefined,
                        },
                    },
                    requestId++,
                );

                ragData = ragSearch?.result?.structuredContent?.data || null;

                if (working.file) {
                    const lspDiag = await callMcp(
                        'tools/call',
                        {
                            name: 'lsp_diagnostics',
                            arguments: { filePath: working.file, maxResults: 20 },
                        },
                        requestId++,
                    );
                    lspData = lspDiag?.result?.structuredContent?.data || null;
                }
            } else if (index === maxMcpFindings) {
                warnings.push(
                    `MCP triage limitado aos primeiros ${maxMcpFindings} achados; fallback determinístico aplicado no restante.`,
                );
            }

            const contextPack = buildContextPack(working, {
                rag: ragData,
                lsp: lspData,
                masterPath: options.masterPath,
            });
            const ranked = rankRootCauses(contextPack);
            const proposal = buildProposalV3(working, {
                rankedCauses: ranked,
                proposeDiffs,
                depth: proposalDepth,
                contextPack,
            });

            working.root_cause = proposal.root_cause;
            working.root_cause_candidates = proposal.root_cause_candidates;
            working.confidence_score = proposal.confidence_score;
            working.suggested_patch = working.suggested_patch || proposal.proposal.summary;
            working.proposal.depth = proposal.proposal.depth;
            working.proposal.summary = proposal.proposal.summary;
            working.proposal.suggested_diff = proposal.proposal.suggested_diff;
            working.proposal.files_touched = proposal.proposal.files_touched;
            working.proposal.test_plan = proposal.proposal.test_plan;
            working.proposal.rollback_hint = proposal.proposal.rollback_hint;
            working.proposal.validation_commands = proposal.proposal.validation_commands;
            working.proposal_context = proposal.proposal_context;
            working.test_strategy = working.test_strategy || proposal.proposal.test_plan.join(' ');
            working.updated_at = new Date().toISOString();
        } catch {
            // handled by fallback
        }

        const criticalType = working.type === 'bug' || working.type === 'gap' || working.type === 'falha de contrato';
        const criticalSeverity = working.severity === 'P0' || working.severity === 'P1';
        working.finding_channel =
            focusMode === 'bug-first'
                ? criticalType && criticalSeverity
                    ? 'primary'
                    : 'backlog'
                : working.finding_channel || 'primary';

        deterministicFallback(working, {
            proposeDiffs,
            proposalDepth,
            masterPath: options.masterPath,
        });
        enriched.push(working);

        if (onProgress) {
            const processed = enriched.length;
            const total = findings.length;
            const percent = total > 0 ? Number(((processed / total) * 100).toFixed(2)) : 100;
            onProgress({
                phase: 'triage-intelligence',
                processed,
                total,
                percent,
                mode: index < maxMcpFindings ? 'mcp' : 'fallback',
                findingId: working.id || null,
            });
        }

        await sleep(20);
    }

    return { findings: enriched, usedMcp: true, degraded: timedOut, warnings };
}
