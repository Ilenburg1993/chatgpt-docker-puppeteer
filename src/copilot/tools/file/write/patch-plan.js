// @ts-check
/**
 * Contrato puro para planos transacionais de patch multi-arquivo.
 *
 * Este módulo não executa mutações; ele normaliza e valida plano antes de qualquer
 * futura integração com `patch_file`/rollback.
 *
 * @module copilot/tools/file/write/patch-plan
 */

/**
 * @typedef {{
 *     path: string;
 *     oldString: string;
 *     newString: string;
 *     expectedHash?: string;
 *     expectedOccurrences?: number;
 *     occurrenceIndex?: number;
 * }} PatchPlanOperation
 *
 * @typedef {{
 *     dryRun: boolean;
 *     atomic: boolean;
 *     operations: PatchPlanOperation[];
 * }} PatchPlan
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function optionalPositiveInteger(value) {
    if (value === undefined || value === null) return undefined;
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : undefined;
}

/**
 * @param {string} content
 * @param {string} needle
 * @returns {number}
 */
function countOccurrences(content, needle) {
    if (!needle) return 0;
    let count = 0;
    let offset = 0;
    while (true) {
        const next = content.indexOf(needle, offset);
        if (next < 0) return count;
        count += 1;
        offset = next + needle.length;
    }
}

/**
 * @param {string} content
 * @param {PatchPlanOperation} operation
 */
function applyOperationToContent(content, operation) {
    const count = countOccurrences(content, operation.oldString);
    const expected = operation.expectedOccurrences;
    if (expected !== undefined && count !== expected) {
        return {
            ok: false,
            content,
            occurrenceCount: count,
            error: `expectedOccurrences mismatch: expected ${expected}, found ${count}`,
        };
    }
    if (count === 0) {
        return { ok: false, content, occurrenceCount: 0, error: 'oldString not found' };
    }
    if (operation.occurrenceIndex !== undefined) {
        if (operation.occurrenceIndex > count) {
            return {
                ok: false,
                content,
                occurrenceCount: count,
                error: `occurrenceIndex out of range: ${operation.occurrenceIndex} > ${count}`,
            };
        }
        let seen = 0;
        let offset = 0;
        while (true) {
            const next = content.indexOf(operation.oldString, offset);
            if (next < 0) break;
            seen += 1;
            if (seen === operation.occurrenceIndex) {
                return {
                    ok: true,
                    content: `${content.slice(0, next)}${operation.newString}${content.slice(next + operation.oldString.length)}`,
                    occurrenceCount: count,
                    changedOccurrences: 1,
                };
            }
            offset = next + operation.oldString.length;
        }
    }
    return {
        ok: true,
        content: content.split(operation.oldString).join(operation.newString),
        occurrenceCount: count,
        changedOccurrences: count,
    };
}

/**
 * @param {string} before
 * @param {string} after
 */
function buildContentPreview(before, after) {
    return {
        beforeBytes: Buffer.byteLength(before, 'utf8'),
        afterBytes: Buffer.byteLength(after, 'utf8'),
        byteDelta: Buffer.byteLength(after, 'utf8') - Buffer.byteLength(before, 'utf8'),
        changed: before !== after,
    };
}

/**
 * @param {unknown} value
 * @returns {{ ok: true; plan: PatchPlan } | { ok: false; errors: string[] }}
 */
export function normalizePatchPlan(value) {
    const record = asRecord(value);
    if (!record) return { ok: false, errors: ['patch plan must be an object'] };
    const rawOperations = Array.isArray(record['operations']) ? record['operations'] : [];
    /** @type {string[]} */
    const errors = [];
    /** @type {PatchPlanOperation[]} */
    const operations = [];
    rawOperations.forEach((raw, index) => {
        const op = asRecord(raw);
        if (!op) {
            errors.push(`operations[${index}] must be an object`);
            return;
        }
        const path = typeof op['path'] === 'string' ? op['path'].trim() : '';
        const oldString = typeof op['oldString'] === 'string' ? op['oldString'] : '';
        const newString = typeof op['newString'] === 'string' ? op['newString'] : undefined;
        if (!path) errors.push(`operations[${index}].path is required`);
        if (!oldString) errors.push(`operations[${index}].oldString is required`);
        if (newString === undefined) errors.push(`operations[${index}].newString is required`);
        const expectedOccurrences = optionalPositiveInteger(op['expectedOccurrences']);
        const occurrenceIndex = optionalPositiveInteger(op['occurrenceIndex']);
        if ('expectedOccurrences' in op && expectedOccurrences === undefined) {
            errors.push(`operations[${index}].expectedOccurrences must be a positive integer`);
        }
        if ('occurrenceIndex' in op && occurrenceIndex === undefined) {
            errors.push(`operations[${index}].occurrenceIndex must be a positive integer`);
        }
        if (path && oldString && newString !== undefined) {
            operations.push({
                path,
                oldString,
                newString,
                ...(typeof op['expectedHash'] === 'string' && op['expectedHash'] ? { expectedHash: op['expectedHash'] } : {}),
                ...(expectedOccurrences !== undefined ? { expectedOccurrences } : {}),
                ...(occurrenceIndex !== undefined ? { occurrenceIndex } : {}),
            });
        }
    });
    if (operations.length === 0) errors.push('patch plan must contain at least one valid operation');
    if (errors.length > 0) return { ok: false, errors };
    return {
        ok: true,
        plan: {
            dryRun: record['dryRun'] !== false,
            atomic: record['atomic'] !== false,
            operations,
        },
    };
}

/**
 * @param {PatchPlan} plan
 */
export function summarizePatchPlan(plan) {
    const files = [...new Set(plan.operations.map((operation) => operation.path))];
    return {
        dryRun: plan.dryRun,
        atomic: plan.atomic,
        operationCount: plan.operations.length,
        fileCount: files.length,
        files,
        requiresAllPreconditions: plan.atomic,
    };
}

/**
 * @param {PatchPlan} plan
 * @param {Record<string, string>} fileContents
 */
export function dryRunPatchPlan(plan, fileContents) {
    /** @type {Record<string, string>} */
    const working = { ...fileContents };
    /** @type {Array<Record<string, unknown>>} */
    const operationResults = [];
    /** @type {string[]} */
    const errors = [];
    for (const [index, operation] of plan.operations.entries()) {
        const before = working[operation.path];
        if (before === undefined) {
            const error = `missing content for ${operation.path}`;
            errors.push(error);
            operationResults.push({ index, path: operation.path, ok: false, error });
            continue;
        }
        const applied = applyOperationToContent(before, operation);
        if (!applied.ok) {
            errors.push(`${operation.path}: ${applied.error}`);
            operationResults.push({
                index,
                path: operation.path,
                ok: false,
                error: applied.error,
                occurrenceCount: applied.occurrenceCount,
            });
            continue;
        }
        working[operation.path] = applied.content;
        operationResults.push({
            index,
            path: operation.path,
            ok: true,
            occurrenceCount: applied.occurrenceCount,
            changedOccurrences: applied.changedOccurrences,
            preview: buildContentPreview(before, applied.content),
        });
    }
    const files = [...new Set(plan.operations.map((operation) => operation.path))];
    const filePreviews = files.map((file) => buildContentPreview(fileContents[file] ?? '', working[file] ?? fileContents[file] ?? ''));
    return {
        ok: errors.length === 0,
        dryRun: true,
        atomic: plan.atomic,
        operationCount: plan.operations.length,
        fileCount: files.length,
        errors,
        operationResults,
        files: files.map((file, index) => ({ path: file, ...filePreviews[index] })),
        wouldApply: errors.length === 0,
    };
}
