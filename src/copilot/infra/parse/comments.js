// @ts-check
/**
 * Parser puro de comentários iniciais.
 *
 * @module copilot/infra/parse/comments
 */

/**
 * Extrai os primeiros comentários de bloco ou linha do arquivo.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractTopComments(content) {
    /** @type {string[]} */
    const comments = [];
    const lines = content.split('\n');
    let inBlock = false;
    let blockLines = /** @type {string[]} */ ([]);

    for (const line of lines.slice(0, 50)) {
        const trimmed = line.trim();
        if (!inBlock && trimmed.startsWith('/*')) {
            inBlock = true;
            blockLines = [line];
            if (trimmed.endsWith('*/')) {
                comments.push(blockLines.join('\n'));
                inBlock = false;
                blockLines = [];
            }
            continue;
        }
        if (inBlock) {
            blockLines.push(line);
            if (trimmed.endsWith('*/')) {
                comments.push(blockLines.join('\n'));
                inBlock = false;
                blockLines = [];
            }
            continue;
        }
        if (trimmed.startsWith('//')) {
            comments.push(line);
        }
    }

    return comments.slice(0, 10);
}
