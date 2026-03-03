import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const DEFAULT_MASTER = path.join(ROOT, 'DOCUMENTAÇÃO', 'BUGS', 'BUG_AUDIT_MASTER.md');

/**
 * @param {string} filePath
 * @param {number|null} line
 * @param {number} radius
 */
function readLocalCodeContext(filePath, line, radius = 6) {
    if (!filePath) {
        return { snippet: null, used: false };
    }
    const resolved = path.resolve(ROOT, filePath);
    if (!fs.existsSync(resolved)) {
        return { snippet: null, used: false };
    }

    const source = fs.readFileSync(resolved, 'utf8');
    const lines = source.split(/\r?\n/);
    const target = Math.max(1, Number(line || 1));
    const start = Math.max(1, target - radius);
    const end = Math.min(lines.length, target + radius);

    const out = [];
    for (let idx = start; idx <= end; idx += 1) {
        const marker = idx === target ? '>' : ' ';
        out.push(`${marker}${String(idx).padStart(5, ' ')} | ${lines[idx - 1] || ''}`);
    }
    return { snippet: out.join('\n'), used: true };
}

/**
 * @param {string} masterPath
 * @param {string|null} contractId
 * @returns {string[]}
 */
function readMasterHistoryHints(masterPath, contractId) {
    if (!contractId || !masterPath || !fs.existsSync(masterPath)) {
        return [];
    }
    const content = fs.readFileSync(masterPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const hits = [];
    for (const line of lines) {
        if (line.includes(contractId)) {
            hits.push(line.trim());
        }
        if (hits.length >= 5) {
            break;
        }
    }
    return hits;
}

/**
 * @param {import('../lib/schema.mjs').AuditFindingV3} finding
 * @param {{ rag?: any, lsp?: any, history?: any, masterPath?: string }} sources
  * @returns {any}
 */
export function buildContextPack(finding, sources = {}) {
    const codeContext = readLocalCodeContext(finding.file, finding.line, 8);
    const masterPath = sources.masterPath || DEFAULT_MASTER;
    const historyHints = Array.isArray(sources.history)
        ? sources.history
        : readMasterHistoryHints(masterPath, finding.contract_id || null);

    return {
        finding: {
            id: finding.id,
            contract_id: finding.contract_id,
            domain: finding.domain,
            severity: finding.severity,
            type: finding.type,
            source_tool: finding.source_tool,
            file: finding.file,
            line: finding.line,
            evidence: finding.evidence,
        },
        code_context: codeContext.snippet,
        code_context_used: codeContext.used,
        rag: sources.rag || null,
        lsp: sources.lsp || null,
        history: historyHints,
    };
}
