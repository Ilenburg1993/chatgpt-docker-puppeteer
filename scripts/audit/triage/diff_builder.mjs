import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * @param {string} filePath
 * @param {number} line
 * @returns {string|null}
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
 * @param {any} finding
 * @param {{ title?: string, cause?: string, replacementHint?: string }} [context]
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

    return [
        `diff --git a/${file} b/${file}`,
        `@@ -${line},1 +${line},1 @@`,
        `-${oldLine}`,
        `+${replacementHint}`,
    ].join('\n');
}
