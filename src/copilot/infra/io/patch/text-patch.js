// @ts-check
/**
 * Patch textual puro.
 *
 * @module copilot/infra/io/patch/text-patch
 */

/**
 * @param {string} content
 * @param {{
 *     oldString: string;
 *     newString: string;
 *     replaceAll?: boolean;
 *     expectedOccurrences?: number;
 * }} options
 * @returns {{ updated: string; occurrences: number; replacedOccurrences: number; bytesWritten: number }}
 */
export function computeTextPatch(content, options) {
    const occurrences = content.split(options.oldString).length - 1;
    if (occurrences === 0) throw new Error('old_string não encontrado no arquivo.');
    if (options.expectedOccurrences !== undefined && options.expectedOccurrences !== occurrences) {
        throw new Error(`expected_occurrences=${options.expectedOccurrences}, mas encontrado=${occurrences}.`);
    }
    if (!options.replaceAll && options.expectedOccurrences === undefined && occurrences > 1) {
        throw new Error(`old_string encontrado ${occurrences} vezes. Inclua mais contexto para identificar unicamente.`);
    }

    const updated = options.replaceAll
        ? content.split(options.oldString).join(options.newString)
        : content.replace(options.oldString, () => options.newString);
    return {
        updated,
        occurrences,
        replacedOccurrences: options.replaceAll ? occurrences : 1,
        bytesWritten: Buffer.byteLength(updated, 'utf8'),
    };
}
