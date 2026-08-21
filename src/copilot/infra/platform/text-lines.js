// @ts-check
/**
 * Iteração lazy de linhas físicas para consumidores textuais.
 *
 * @module copilot/infra/platform/text-lines
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
 * Materializa linhas físicas somente quando o contrato do caller exige um array.
 *
 * @param {string} content
 * @param {{ emptyAsNoLines?: boolean }} [options]
 * @returns {string[]}
 */
export function splitPhysicalTextLines(content, options = {}) {
    if (content.length === 0 && options.emptyAsNoLines === true) return [];
    /** @type {string[]} */
    const lines = [];
    let start = 0;
    for (let index = 0; index < content.length; index += 1) {
        const code = content.charCodeAt(index);
        if (code !== 10 && code !== 13) continue;
        lines.push(content.slice(start, index));
        if (code === 13 && content.charCodeAt(index + 1) === 10) index += 1;
        start = index + 1;
    }
    lines.push(content.slice(start));
    return lines;
}

/**
 * Coleta offsets UTF-16 de início de linha física para acesso aleatório repetido.
 *
 * @param {string} content
 * @returns {Uint32Array}
 */
export function collectPhysicalLineStarts(content) {
    let lineCount = 1;
    for (let index = 0; index < content.length; index += 1) {
        const code = content.charCodeAt(index);
        if (code !== 10 && code !== 13) continue;
        if (code === 13 && content.charCodeAt(index + 1) === 10) index += 1;
        lineCount += 1;
    }

    const starts = new Uint32Array(lineCount);
    let lineIndex = 1;
    for (let index = 0; index < content.length; index += 1) {
        const code = content.charCodeAt(index);
        if (code !== 10 && code !== 13) continue;
        if (code === 13 && content.charCodeAt(index + 1) === 10) index += 1;
        starts[lineIndex] = index + 1;
        lineIndex += 1;
    }
    return starts;
}

/**
 * Recorta uma janela 1-based em uma única varredura e memória O(1). Delimitadores internos são preservados; o
 * delimitador final da janela é excluído.
 *
 * @param {string} content
 * @param {{ startLine?: number | undefined; endLine?: number | undefined }} [window]
 * @returns {{ content: string; totalLines: number; returnedLines: { start: number; end: number } }}
 */
export function slicePhysicalTextLines(content, window = {}) {
    const requestedStart = Math.max(1, Math.trunc(window.startLine ?? 1));
    const requestedEnd = window.endLine === undefined ? Number.POSITIVE_INFINITY : Math.trunc(window.endLine);
    let currentLine = 1;
    let contentStart = requestedStart === 1 ? 0 : -1;
    let contentEnd = -1;

    for (let index = 0; index < content.length; index += 1) {
        const code = content.charCodeAt(index);
        if (code !== 10 && code !== 13) continue;

        if (currentLine === requestedEnd) contentEnd = index;
        if (code === 13 && content.charCodeAt(index + 1) === 10) index += 1;
        currentLine += 1;
        if (currentLine === requestedStart) contentStart = index + 1;
    }

    const totalLines = currentLine;
    const sliceStart = Math.min(requestedStart, totalLines + 1);
    const sliceEnd = sliceStart > totalLines ? totalLines : Math.min(requestedEnd, totalLines);
    if (sliceStart > totalLines || sliceEnd < sliceStart) {
        return { content: '', totalLines, returnedLines: { start: sliceStart, end: sliceEnd } };
    }

    const resolvedEnd = sliceEnd >= totalLines ? content.length : contentEnd;
    return {
        content: content.slice(contentStart, resolvedEnd),
        totalLines,
        returnedLines: { start: sliceStart, end: sliceEnd },
    };
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
 * Retorna a linha física 1-based de um offset UTF-16, sem criar substring. CRLF conta somente depois que ambos os code
 * units ficaram antes do offset.
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
