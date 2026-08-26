// @ts-check
/**
 * Repository patch result-validation policy.
 *
 * Format-specific repository invariants live above generic filesystem IO. Validators run against the computed
 * in-memory result before atomic publication.
 *
 * @module copilot/mcp/workspace/repository/patch/result-validation
 */

import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import path from 'node:path';

/** @param {string} relativePath */
function usesJsonWithCommentsSyntax(relativePath) {
    const normalized = relativePath.replaceAll('\\', '/');
    const basename = path.basename(normalized).toLowerCase();
    return (
        path.extname(normalized).toLowerCase() === '.jsonc' ||
        normalized.startsWith('.vscode/') ||
        normalized.startsWith('.devcontainer/') ||
        /^(?:tsconfig|jsconfig)(?:\..+)?\.json$/u.test(basename)
    );
}

/**
 * @param {string} relativePath
 * @returns {((content: string) => void) | undefined}
 */
function buildRepositoryPatchResultValidator(relativePath) {
    const extension = path.extname(relativePath).toLowerCase();
    if (extension !== '.json' && extension !== '.jsonc') return undefined;
    const jsonc = usesJsonWithCommentsSyntax(relativePath);
    return (content) => {
        const jsonText = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
        try {
            if (!jsonc) {
                JSON.parse(jsonText);
                return;
            }
            /** @type {import('jsonc-parser').ParseError[]} */
            const errors = [];
            parseJsonc(jsonText, errors, { allowTrailingComma: true, disallowComments: false });
            if (errors.length > 0) {
                const first = /** @type {import('jsonc-parser').ParseError} */ (errors[0]);
                throw new SyntaxError(`${printParseErrorCode(first.error)} at offset ${first.offset}`);
            }
        } catch (cause) {
            const parserMessage = cause instanceof Error ? cause.message : String(cause);
            const syntaxLabel = jsonc ? 'JSONC' : 'JSON';
            const error = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (
                new Error(`Patch result would make ${relativePath} invalid ${syntaxLabel}: ${parserMessage}`)
            );
            error.code = 'ERR_PATCH_INVALID_JSON_RESULT';
            error.details = {
                validation: jsonc ? 'jsonc-parse' : 'json-parse',
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
