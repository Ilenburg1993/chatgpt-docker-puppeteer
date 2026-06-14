// @ts-check
/**
 * Iteração lazy de linhas físicas para consumidores textuais.
 *
 * @module copilot/infra/shared/text-lines
 */

/**
 * Itera LF, CRLF e CR isolado sem materializar um array proporcional ao texto.
 *
 * @param {string} content
 * @returns {Generator<{ text: string; line: number }>}
 */
export function* iterateTextLines(content) {
    let line = 1;
    let start = 0;
    for (let index = 0; index < content.length; index += 1) {
        const code = content.charCodeAt(index);
        if (code !== 10 && code !== 13) continue;

        yield { text: content.slice(start, index), line };
        if (code === 13 && content.charCodeAt(index + 1) === 10) index += 1;
        start = index + 1;
        line += 1;
    }
    yield { text: content.slice(start), line };
}

/**
 * Conta linhas físicas, considerando string vazia como uma linha-base.
 *
 * @param {string} content
 * @returns {number}
 */
export function countPhysicalTextLines(content) {
    return lineNumberAtTextOffset(content, content.length);
}

/**
 * Retorna a linha física 1-based de um offset UTF-16, sem criar substring.
 * CRLF conta somente depois que ambos os code units ficaram antes do offset.
 *
 * @param {string} content
 * @param {number} offset
 * @returns {number}
 */
export function lineNumberAtTextOffset(content, offset) {
    const limit = Math.max(0, Math.min(content.length, Math.floor(offset)));
    let line = 1;
    let index = 0;
    while (index < limit) {
        const code = content.charCodeAt(index);
        if (code === 13) {
            if (content.charCodeAt(index + 1) === 10) {
                if (index + 1 >= limit) break;
                index += 2;
            } else {
                index += 1;
            }
            line += 1;
            continue;
        }
        if (code === 10) line += 1;
        index += 1;
    }
    return line;
}
