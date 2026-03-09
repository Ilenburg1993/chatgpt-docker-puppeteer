// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * @param {string} filePath
 * @param {number} line
 * @returns {string | null}
 */
function readTargetLine(filePath, line) {
    const full = path.resolve(ROOT, filePath);
    if (!fs.existsSync(full)) {
        return null;
    }
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    const index = Math.max(1, Number(line || 1)) - 1;
    return lines[index] ?? null;
}

/**
 * @param {string} line
 */
function getIndentation(line) {
    const match = String(line || '').match(/^\s*/);
    return match ? match[0] : '';
}

/** @typedef {any} BuildContractAwareReplacementFinding */
/**
 * @param {BuildContractAwareReplacementFinding} finding
 * @param {string} oldLine
 * @param {string} fallback
 */
function buildContractAwareReplacement(finding, oldLine, fallback) {
    const contractId = String(finding?.contract_id || '');
    const indent = getIndentation(oldLine);
    const trimmed = String(oldLine || '').trim();

    if (contractId === 'CONTRACT-STATIC-HARDCODED-PORTS') {
        const assignment = trimmed.match(/^const\s+([A-Za-z0-9_$]+)\s*=/);
        if (assignment) {
            const variable = assignment[1];
            return `${indent}const ${variable} = Number(CONFIG.CHROME_PROXY_PORT ?? process.env.CHROME_PROXY_PORT);`;
        }
        if (/\b9222\b|\b9224\b/.test(trimmed)) {
            return `${indent}${trimmed.replace(/\b9222\b|\b9224\b/g, 'Number(CONFIG.CHROME_PROXY_PORT ?? process.env.CHROME_PROXY_PORT)')}`;
        }
    }

    if (contractId === 'CONTRACT-STATIC-PROCESS-EXIT' && /process\.exit\s*\(/.test(trimmed)) {
        const exitCodeMatch = trimmed.match(/process\.exit\s*\(\s*([^)]+)\s*\)/);
        const exitCode = exitCodeMatch ? String(exitCodeMatch[1]).trim() : '1';
        if (exitCode === '0') {
            return `${indent}return; // graceful shutdown delegado ao entrypoint`;
        }
        return `${indent}throw new Error('Encerramento solicitado (exit ${exitCode}) fora de entrypoint; delegue para lifecycle/shutdown central.');`;
    }

    return fallback;
}

/**
 * @typedef {object} BuildSuggestedDiffContext
 * @property {string | undefined} [title]
 * @property {string | undefined} [cause]
 * @property {string | undefined} [replacementHint]
 */
/** @typedef {any} BuildSuggestedDiffFinding */
/**
 * @param {BuildSuggestedDiffFinding} finding
 * @param {BuildSuggestedDiffContext} [context]
 * @returns {any}
 */
export function buildSuggestedDiff(finding, context = {}) {
    if (!finding?.file) {
        return null;
    }
    const file = String(finding.file);
    const line = Number.isInteger(finding.line) ? finding.line : 1;
    const title = context.title || finding.contract_id || finding.source_tool || 'audit-fix';
    const cause = context.cause || finding.root_cause || 'Restaurar contrato esperado';
    const oldLine = readTargetLine(file, line);
    if (!oldLine) {
        return [
            `diff --git a/${file} b/${file}`,
            `@@ -${line},1 +${line},1 @@`,
            `- /* linha alvo indisponível para sugestão contextual */`,
            `+ /* FIX(${title}): ${cause} */`,
        ].join('\n');
    }

    const replacementHint = context.replacementHint
        ? String(context.replacementHint)
        : `${oldLine} // FIX(${title}): ${cause}`;
    const semanticReplacement = buildContractAwareReplacement(finding, oldLine, replacementHint);

    return [
        `diff --git a/${file} b/${file}`,
        `@@ -${line},1 +${line},1 @@`,
        `-${oldLine}`,
        `+${semanticReplacement}`,
    ].join('\n');
}
