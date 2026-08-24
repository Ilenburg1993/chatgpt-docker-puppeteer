// @ts-check
/**
 * Repository patch result-validation policy.
 *
 * Format-specific repository invariants live above generic filesystem IO. Validators run against the computed
 * in-memory result before atomic publication.
 *
 * @module copilot/mcp/workspace/repository/patch/result-validation
 */

import path from 'node:path';

/**
 * @param {string} relativePath
 * @returns {((content: string) => void) | undefined}
 */
function buildRepositoryPatchResultValidator(relativePath) {
    if (path.extname(relativePath).toLowerCase() !== '.json') return undefined;
    return (content) => {
        const jsonText = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
        try {
            JSON.parse(jsonText);
        } catch (cause) {
            const parserMessage = cause instanceof Error ? cause.message : String(cause);
            const error = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (
                new Error(`Patch result would make ${relativePath} invalid JSON: ${parserMessage}`)
            );
            error.code = 'ERR_PATCH_INVALID_JSON_RESULT';
            error.details = {
                validation: 'json-parse',
                path: relativePath,
                parserMessage,
                mutationPublished: false,
            };
            throw error;
        }
    };
}

/** @param {string} relativePath */
export function createRepositoryPatchResultValidationOption(relativePath) {
    const validateUpdatedContent = buildRepositoryPatchResultValidator(relativePath);
    return validateUpdatedContent ? { validateUpdatedContent } : {};
}
