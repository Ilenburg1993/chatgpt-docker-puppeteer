import { spawn } from 'node:child_process';

/**
 * Runs a command and captures stdout/stderr without throwing.
 * @param {string} command
 * @param {string[]} args
 * @param {{
 *   cwd?: string,
 *   env?: Record<string,string|undefined>,
 *   timeoutMs?: number,
 *   maxStdoutBytes?: number,
 *   maxStderrBytes?: number,
 *   truncationHeadRatio?: number,
 *   shell?: boolean,
 *   stdio?: any,
 *   onStdout?: (chunk: string) => void,
 *   onStderr?: (chunk: string) => void,
 * }} [options]
 * @returns {Promise<{ ok: boolean, exitCode: number|null, stdout: string, stderr: string, durationMs: number, timedOut: boolean, command: string, stdoutBytes: number, stderrBytes: number, stdoutTruncated: boolean, stderrTruncated: boolean }>}
 */
export async function runCommand(command, args = [], options = {}) {
    const startedAt = Date.now();
    const timeoutMs = Number(options.timeoutMs || 0);
    const maxStdoutBytes = Math.max(65536, Number(options.maxStdoutBytes || 1024 * 1024));
    const maxStderrBytes = Math.max(65536, Number(options.maxStderrBytes || 1024 * 1024));
    const headRatio = Math.max(0.2, Math.min(0.8, Number(options.truncationHeadRatio || 0.6)));

    return new Promise(resolve => {
        const child = spawn(command, args, {
            cwd: options.cwd || process.cwd(),
            env: { ...process.env, ...(options.env || {}) },
            shell: options.shell ?? process.platform === 'win32',
            stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let stdoutTruncated = false;
        let stderrTruncated = false;
        let timedOut = false;
        let timeout = null;

        if (child.stdout) {
            child.stdout.on('data', chunk => {
                const text = String(chunk);
                const bounded = appendBoundedOutput({
                    current: stdout,
                    incoming: text,
                    previousBytes: stdoutBytes,
                    limitBytes: maxStdoutBytes,
                    wasTruncated: stdoutTruncated,
                    headRatio,
                    marker: '\n... [stdout truncated] ...\n',
                });
                stdout = bounded.text;
                stdoutBytes = bounded.totalBytes;
                stdoutTruncated = bounded.truncated;
                if (typeof options.onStdout === 'function') {
                    options.onStdout(text);
                }
            });
        }

        if (child.stderr) {
            child.stderr.on('data', chunk => {
                const text = String(chunk);
                const bounded = appendBoundedOutput({
                    current: stderr,
                    incoming: text,
                    previousBytes: stderrBytes,
                    limitBytes: maxStderrBytes,
                    wasTruncated: stderrTruncated,
                    headRatio,
                    marker: '\n... [stderr truncated] ...\n',
                });
                stderr = bounded.text;
                stderrBytes = bounded.totalBytes;
                stderrTruncated = bounded.truncated;
                if (typeof options.onStderr === 'function') {
                    options.onStderr(text);
                }
            });
        }

        if (timeoutMs > 0) {
            timeout = setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
            }, timeoutMs);
        }

        child.on('error', err => {
            if (timeout) {
                clearTimeout(timeout);
            }
            resolve({
                ok: false,
                exitCode: null,
                stdout,
                stderr: `${stderr}\n${err.message}`,
                durationMs: Date.now() - startedAt,
                timedOut,
                command: [command, ...args].join(' '),
                stdoutBytes,
                stderrBytes,
                stdoutTruncated,
                stderrTruncated,
            });
        });

        child.on('close', code => {
            if (timeout) {
                clearTimeout(timeout);
            }
            resolve({
                ok: code === 0 && !timedOut,
                exitCode: code,
                stdout,
                stderr,
                durationMs: Date.now() - startedAt,
                timedOut,
                command: [command, ...args].join(' '),
                stdoutBytes,
                stderrBytes,
                stdoutTruncated,
                stderrTruncated,
            });
        });
    });
}

/**
 * @param {{
 *   current: string,
 *   incoming: string,
 *   previousBytes: number,
 *   limitBytes: number,
 *   wasTruncated: boolean,
 *   headRatio: number,
 *   marker: string,
 * }} input
 */
function appendBoundedOutput(input) {
    const incomingBytes = Buffer.byteLength(input.incoming, 'utf8');
    const totalBytes = input.previousBytes + incomingBytes;
    if (!input.wasTruncated && totalBytes <= input.limitBytes) {
        return {
            text: input.current + input.incoming,
            totalBytes,
            truncated: false,
        };
    }

    const combined = input.current + input.incoming;
    const marker = input.marker;
    const markerBytes = Buffer.byteLength(marker, 'utf8');
    const usableBytes = Math.max(0, input.limitBytes - markerBytes);
    const headBytes = Math.max(0, Math.floor(usableBytes * input.headRatio));
    const tailBytes = Math.max(0, usableBytes - headBytes);
    const head = sliceByUtf8Bytes(combined, headBytes, false);
    const tail = sliceByUtf8Bytes(combined, tailBytes, true);

    return {
        text: `${head}${marker}${tail}`,
        totalBytes,
        truncated: true,
    };
}

/**
 * @param {string} text
 * @param {number} maxBytes
 * @param {boolean} fromEnd
 */
function sliceByUtf8Bytes(text, maxBytes, fromEnd) {
    if (maxBytes <= 0 || !text) {
        return '';
    }
    const raw = Buffer.from(text, 'utf8');
    if (raw.byteLength <= maxBytes) {
        return text;
    }
    const chunk = fromEnd ? raw.subarray(raw.byteLength - maxBytes) : raw.subarray(0, maxBytes);
    return chunk.toString('utf8');
}

/**
 * @param {string} binary
 * @param {(command: string, args: string[], options?: any) => Promise<{ ok: boolean }>} [execFn]
 * @returns {Promise<boolean>}
 */
export async function commandExists(binary, execFn = runCommand) {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    const result = await execFn(checker, [binary], { timeoutMs: 10000 });
    return result.ok;
}

/**
 * @param {string} text
 * @returns {any|null}
 */
function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * Extracts balanced JSON object blocks from a mixed output stream.
 * Scans with string-escape awareness to avoid braces inside quoted strings.
 * @param {string} text
 * @returns {string[]}
 */
function extractBalancedJsonObjectBlocks(text) {
    /** @type {string[]} */
    const blocks = [];
    const stack = [];
    let inString = false;
    let stringQuote = '';
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
        const ch = text[index];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === stringQuote) {
                inString = false;
                stringQuote = '';
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            stringQuote = ch;
            escaped = false;
            continue;
        }

        if (ch === '{') {
            stack.push(index);
            continue;
        }

        if (ch === '}' && stack.length > 0) {
            const start = stack.pop();
            if (stack.length === 0 && Number.isInteger(start)) {
                blocks.push(text.slice(start, index + 1));
            }
        }
    }

    return blocks;
}

/**
 * Attempts to parse a JSON object from noisy stdout.
 * @param {string} stdout
 * @param {{ preferLast?: boolean }} [options]
 * @returns {any|null}
 */
export function parseJsonFromMixedOutput(stdout, options = {}) {
    const text = String(stdout || '')
        .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
        .trim();
    if (!text) {
        return null;
    }

    const direct = tryParseJson(text);
    if (direct) {
        return direct;
    }

    const preferLast = options.preferLast !== false;

    // Prefer complete JSON object blocks. By default, parse the last valid block first.
    const blocks = extractBalancedJsonObjectBlocks(text);
    const orderedBlocks = preferLast ? [...blocks].reverse() : blocks;
    /** @type {any[]} */
    const parsedCandidates = [];
    for (const block of orderedBlocks) {
        const parsed = tryParseJson(block);
        if (parsed && typeof parsed === 'object') {
            parsedCandidates.push(parsed);
            if (Object.prototype.hasOwnProperty.call(parsed, 'ok') || Object.prototype.hasOwnProperty.call(parsed, 'result')) {
                return parsed;
            }
        }
    }
    if (parsedCandidates.length > 0) {
        const withKeys = parsedCandidates.find(item => !Array.isArray(item) && Object.keys(item).length > 0);
        if (withKeys) {
            return withKeys;
        }
        return parsedCandidates[0];
    }

    // Fallback: lines starting with "{" in case output is truncated around the block.
    const lines = text.split(/\r?\n/);
    const indexes = preferLast
        ? Array.from({ length: lines.length }, (_item, idx) => lines.length - idx - 1)
        : Array.from({ length: lines.length }, (_item, idx) => idx);
    for (const start of indexes) {
        if (!String(lines[start] || '').trim().startsWith('{')) {
            continue;
        }
        const candidate = lines.slice(start).join('\n').trim();
        const parsed = tryParseJson(candidate);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    }
    return null;
}
