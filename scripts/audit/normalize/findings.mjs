import path from 'node:path';
import { BLAST_RADIUS, FINDING_STATUS, FINDING_TYPES, SEVERITIES } from '../lib/schema.mjs';
import { getMaxBugId, makeBugId, makeFingerprint } from '../lib/fingerprint.mjs';

const DEFAULT_STATUS = /** @type {const} */ ('confirmado');
const DEFAULT_TYPE = /** @type {const} */ ('bug');

/**
 * @typedef {object} RawFinding
 * @property {string} source_tool
 * @property {string|null} [contract_id]
 * @property {string|null} [domain]
 * @property {string|null} [owner]
 * @property {'off'|'warn'|'p1'|'p0'|null} [enforcement_state]
 * @property {string|null} [file]
 * @property {number|null} [line]
 * @property {string} evidence
 * @property {string|null} [rule]
 * @property {string|null} [severity_hint]
 * @property {string|null} [status]
 * @property {string|null} [type]
 * @property {string|null} [impact]
 * @property {string|null} [root_cause]
 * @property {string|null} [suggested_patch]
 * @property {string|null} [test_strategy]
 * @property {string|null} [regression_risk]
 * @property {boolean} [partial]
 */

/**
 * @param {string|null|undefined} severityHint
 * @param {string|null|undefined} sourceTool
 * @returns {'P0'|'P1'|'P2'|'P3'}
 */
function mapSeverity(severityHint, sourceTool) {
    const hint = String(severityHint || '')
        .toUpperCase()
        .trim();
    if (SEVERITIES.includes(hint)) {
        return /** @type {'P0'|'P1'|'P2'|'P3'} */ (hint);
    }

    if (String(sourceTool).includes('mcp:diagnose')) return 'P1';
    if (String(sourceTool).includes('rag:health')) return 'P1';
    if (String(sourceTool).includes('check:forbidden')) return 'P1';
    if (String(sourceTool).includes('typecheck')) return 'P1';
    if (String(sourceTool).includes('lint')) return 'P2';
    if (String(sourceTool).includes('jscpd')) return 'P2';
    if (String(sourceTool).includes('madge')) return 'P2';
    if (String(sourceTool).includes('semgrep')) return 'P1';

    return 'P2';
}

/**
 * @param {string|null|undefined} value
 * @returns {'novo'|'confirmado'|'patch-proposto'|'corrigido'|'validado'|'descartado'}
 */
function mapStatus(value) {
    const normalized = String(value || '').trim();
    if (FINDING_STATUS.includes(normalized)) {
        return /** @type {'novo'|'confirmado'|'patch-proposto'|'corrigido'|'validado'|'descartado'} */ (normalized);
    }
    return DEFAULT_STATUS;
}

/**
 * @param {string|null|undefined} value
 * @returns {'bug'|'gap'|'falha de contrato'|'incompletude'|'upgrade'}
 */
function mapType(value) {
    const normalized = String(value || '').trim();
    if (FINDING_TYPES.includes(normalized)) {
        return /** @type {'bug'|'gap'|'falha de contrato'|'incompletude'|'upgrade'} */ (normalized);
    }
    return DEFAULT_TYPE;
}

/**
 * @param {{ severity: string, type: string }} finding
 */
function inferChannel(finding) {
    const criticalType = finding.type === 'bug' || finding.type === 'gap' || finding.type === 'falha de contrato';
    const criticalSeverity = finding.severity === 'P0' || finding.severity === 'P1';
    return criticalType && criticalSeverity ? 'primary' : 'backlog';
}

/**
 * @param {RawFinding[]} rawFindings
 * @param {{ masterPath: string, now?: Date }} options
 * @returns {import('../lib/schema.mjs').AuditFindingV3[]}
 */
export function normalizeFindings(rawFindings, options) {
    const now = options.now || new Date();
    const iso = now.toISOString();

    /** @type {Map<string, import('../lib/schema.mjs').AuditFindingV3>} */
    const deduped = new Map();

    for (const raw of rawFindings) {
        const file = raw.file ? String(raw.file) : null;
        const fileKey = file ? path.normalize(file) : 'n/a';
        const line = Number.isInteger(raw.line) ? raw.line : null;
        const rule = String(raw.rule || 'rule:unknown');
        const sourceTool = String(raw.source_tool || 'unknown');
        const evidence = String(raw.evidence || '').trim();

        if (!evidence) {
            continue;
        }

        const fingerprint = makeFingerprint([sourceTool, fileKey, String(line || 0), rule, evidence]);

        if (deduped.has(fingerprint)) {
            continue;
        }

        const severity = mapSeverity(raw.severity_hint, sourceTool);
        const type = mapType(raw.type);
        const blastRadius = /** @type {'baixo'|'medio'|'alto'} */ (
            severity === 'P0' ? 'alto' : severity === 'P1' ? 'medio' : 'baixo'
        );

        if (!BLAST_RADIUS.includes(blastRadius)) {
            continue;
        }

        deduped.set(fingerprint, {
            id: 'PENDING',
            contract_id: raw.contract_id || null,
            domain: raw.domain || null,
            owner: raw.owner || null,
            severity,
            status: mapStatus(raw.status),
            type,
            source_tool: sourceTool,
            file,
            line,
            evidence,
            impact: raw.impact || null,
            root_cause: raw.root_cause || null,
            suggested_patch: raw.suggested_patch || null,
            test_strategy: raw.test_strategy || null,
            regression_risk: raw.regression_risk || null,
            fingerprint,
            created_at: iso,
            updated_at: iso,
            confidence_score: 0.55,
            blast_radius: blastRadius,
            proposal: {
                depth: 'standard',
                summary: null,
                suggested_diff: null,
                files_touched: file ? [file] : [],
                test_plan: [],
                rollback_hint: null,
                validation_commands: [],
            },
            proposal_context: {
                code_context_used: false,
                rag_scope: null,
                lsp_signal_quality: null,
            },
            root_cause_candidates: [],
            evidence_graph_id: null,
            enforcement_state: raw.enforcement_state || 'warn',
            finding_channel: inferChannel({ severity, type }),
            partial: Boolean(raw.partial),
        });
    }

    let nextId = getMaxBugId(options.masterPath) + 1;
    const findings = [...deduped.values()];
    for (const finding of findings) {
        finding.id = makeBugId(now, nextId);
        nextId += 1;
    }

    return findings.sort((a, b) => a.id.localeCompare(b.id));
}
