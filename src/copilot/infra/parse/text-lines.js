// @ts-check
/**
 * Iteração lazy de linhas físicas para parsers puros.
 *
 * @module copilot/infra/parse/text-lines
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
