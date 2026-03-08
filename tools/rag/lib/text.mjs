// @ts-check
export function isProbablyBinary(/** @type {any} */ buf) {
    const sample = buf.subarray(0, Math.min(buf.length, 8192));
    for (const b of sample) {
        if (b === 0) return true;
    }
    const text = sample.toString('utf8');
    if (!text) return false;
    let replacement = 0;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 0xfffd) replacement++;
    }
    return replacement / text.length > 0.02;
}

export function buildLineIndex(/** @type {any} */ buf) {
    const lineStarts = [0];
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) lineStarts.push(i + 1);
    }
    const lines = [];
    for (let i = 0; i < lineStarts.length; i++) {
        const start = lineStarts[i];
        const end = i + 1 < lineStarts.length ? lineStarts[i + 1] : buf.length;
        const slice = buf.subarray(start, end);
        lines.push(slice.toString('utf8').replace(/\r?\n$/, ''));
    }
    return { lineStarts, lines };
}

export function sliceByLines(
    /** @type {any} */ buf,
    /** @type {any} */ lineStarts,
    /** @type {any} */ startLine1,
    /** @type {any} */ endLine1Inclusive,
) {
    const startIdx = Math.max(1, startLine1) - 1;
    const endIdx = Math.max(startIdx, endLine1Inclusive) - 1;
    const startByte = lineStarts[startIdx] ?? 0;
    const endByte = endIdx + 1 < lineStarts.length ? lineStarts[endIdx + 1] : buf.length;
    const text = buf.subarray(startByte, endByte).toString('utf8');
    return { startByte, endByte, text };
}

export function estimateCharsForLines(
    /** @type {any} */ lines,
    /** @type {any} */ startIdx0,
    /** @type {any} */ endIdx0Inclusive,
) {
    let len = 0;
    for (let i = startIdx0; i <= endIdx0Inclusive && i < lines.length; i++) {
        len += lines[i].length + 1;
    }
    return len;
}
