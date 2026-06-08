// @ts-check

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { glob as fsGlob } from 'node:fs/promises';
import path from 'node:path';

const cwd = process.cwd();
const isWindows = process.platform === 'win32';
const npxCommand = isWindows ? 'npx.cmd' : 'npx';

/**
 * @typedef {{
 *     kind: 'warn' | 'error' | 'failure';
 *     sample: string;
 *     count: number;
 *     stream: 'stdout' | 'stderr';
 * }} InterestingLineStat
 */

/**
 * @typedef {{
 *     file: string;
 *     fullName: string;
 *     title: string;
 *     durationMs: number | null;
 *     location: { line: number; column: number } | null;
 *     excerpt: string[];
 * }} FailureSummary
 */

/**
 * @typedef {{
 *     file: string;
 *     message: string[];
 * }} SuiteFailureSummary
 */

/**
 * @param {string} value
 * @returns {string}
 */
function stripAnsi(value) {
    return value.replace(/\u001B\[[0-9;]*m/gu, '');
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeWhitespace(value) {
    return value.replace(/\s+/gu, ' ').trim();
}

/**
 * @param {string} value
 * @returns {string}
 */
function summarizeLine(value) {
    const clean = normalizeWhitespace(stripAnsi(value));
    if (clean.length <= 220) return clean;
    return `${clean.slice(0, 219)}…`;
}

/**
 * @param {string} value
 * @returns {'warn' | 'error' | 'failure' | null}
 */
function classifyLine(value) {
    const clean = stripAnsi(value).trim();
    if (!clean) return null;

    if (/\b(?:FAIL|FAILED)\b/iu.test(clean) || /^\s*[×✖]/u.test(clean)) return 'failure';
    if (/\]\s*(?:ERROR|FATAL)\b/u.test(clean) || /^\[(?:ERROR|FATAL)\]/u.test(clean)) {
        return 'error';
    }
    if (/\]\s*WARN\b/u.test(clean) || /^\[WARN\]/u.test(clean) || /\bWARNING\b/iu.test(clean)) {
        return 'warn';
    }
    if (/(?:AssertionError|TypeError:|ReferenceError:|SyntaxError:|RangeError:|Unhandled)/u.test(clean)) {
        return 'error';
    }

    return null;
}

/**
 * @param {string} value
 * @returns {string}
 */
function fingerprintLine(value) {
    return summarizeLine(value)
        .replace(/^\[[0-9TZ:.-]+\]\s*/u, '[ts] ')
        .replace(/'[^']+'/gu, "'*'")
        .replace(/"[^"]+"/gu, '"*"')
        .replace(/\btrace=[^, )]+/gu, 'trace=*')
        .replace(/\brequestId=[^, )]+/gu, 'requestId=*')
        .replace(/\bruntimeId=[^, )]+/gu, 'runtimeId=*')
        .replace(/\btoolCallId=[^, )]+/gu, 'toolCallId=*')
        .replace(/\bduration=\d+ms\b/gu, 'duration=*ms')
        .replace(/__vite_ssr_import_\d+__/gu, '__vite_ssr_import_*__')
        .replace(/\s+/gu, ' ')
        .trim();
}

/**
 * @param {string[]} lines
 * @param {string} line
 * @param {number} maxLines
 * @returns {void}
 */
function pushRing(lines, line, maxLines) {
    lines.push(line);
    if (lines.length > maxLines) {
        lines.splice(0, lines.length - maxLines);
    }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractFailureExcerpt(text) {
    const lines = stripAnsi(String(text || ''))
        .split(/\r?\n/u)
        .map((line) => line.trimRight())
        .filter(Boolean);

    if (lines.length === 0) return ['(sem detalhes)'];

    const excerpt = [];
    let totalChars = 0;
    for (const line of lines) {
        const compact = line.length <= 180 ? line : `${line.slice(0, 179)}…`;
        excerpt.push(compact);
        totalChars += compact.length;
        if (excerpt.length >= 8 || totalChars >= 1200) break;
    }
    return excerpt;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} report
 * @returns {FailureSummary[]}
 */
function collectFailures(report) {
    const root = asRecord(report);
    const testResults = Array.isArray(root.testResults) ? root.testResults : [];
    const failures = [];

    for (const suite of testResults) {
        const suiteData = asRecord(suite);
        const file = typeof suiteData.name === 'string' ? suiteData.name : '(suite desconhecida)';
        const assertionResults = Array.isArray(suiteData.assertionResults) ? suiteData.assertionResults : [];
        for (const assertion of assertionResults) {
            const testData = asRecord(assertion);
            if (testData.status !== 'failed') continue;
            const failureMessages = Array.isArray(testData.failureMessages) ? testData.failureMessages : [];
            const firstMessage = typeof failureMessages[0] === 'string' ? failureMessages[0] : '';
            const location = asRecord(testData.location);
            failures.push({
                file,
                fullName:
                    typeof testData.fullName === 'string'
                        ? testData.fullName
                        : typeof testData.title === 'string'
                          ? testData.title
                          : '(falha sem nome)',
                title: typeof testData.title === 'string' ? testData.title : '(falha sem título)',
                durationMs: typeof testData.duration === 'number' ? testData.duration : null,
                location:
                    typeof location.line === 'number' && typeof location.column === 'number'
                        ? { line: location.line, column: location.column }
                        : null,
                excerpt: extractFailureExcerpt(firstMessage),
            });
        }
    }

    return failures;
}

/**
 * @param {unknown} report
 * @returns {SuiteFailureSummary[]}
 */
function collectSuiteFailures(report) {
    const root = asRecord(report);
    const testResults = Array.isArray(root.testResults) ? root.testResults : [];
    const suiteFailures = [];

    for (const suite of testResults) {
        const suiteData = asRecord(suite);
        if (suiteData.status !== 'failed') continue;
        const file = typeof suiteData.name === 'string' ? suiteData.name : '(suite desconhecida)';
        const message = extractFailureExcerpt(typeof suiteData.message === 'string' ? suiteData.message : '');
        suiteFailures.push({ file, message });
    }

    return suiteFailures;
}

/**
 * @param {unknown} report
 * @returns {{
 *     numFailedTests: number;
 *     numFailedTestSuites: number;
 *     numPassedTests: number;
 *     numPassedTestSuites: number;
 *     numPendingTests: number;
 *     numPendingTestSuites: number;
 *     numTodoTests: number;
 *     numTotalTests: number;
 *     numTotalTestSuites: number;
 *     startTime: number;
 *     success: boolean;
 * }}
 */
function summarizeCounts(report) {
    const root = asRecord(report);
    return {
        numFailedTests: Number(root.numFailedTests || 0),
        numFailedTestSuites: Number(root.numFailedTestSuites || 0),
        numPassedTests: Number(root.numPassedTests || 0),
        numPassedTestSuites: Number(root.numPassedTestSuites || 0),
        numPendingTests: Number(root.numPendingTests || 0),
        numPendingTestSuites: Number(root.numPendingTestSuites || 0),
        numTodoTests: Number(root.numTodoTests || 0),
        numTotalTests: Number(root.numTotalTests || 0),
        numTotalTestSuites: Number(root.numTotalTestSuites || 0),
        startTime: Number(root.startTime || Date.now()),
        success: Boolean(root.success),
    };
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatDuration(value) {
    if (!Number.isFinite(value) || value < 1000) return `${Math.max(0, Math.round(value))}ms`;
    return `${(value / 1000).toFixed(1)}s`;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function rel(filePath) {
    return path.relative(cwd, filePath) || filePath;
}

const passthroughArgs = [];
let fullOutput = process.env.COPILOT_TEST_LOG_FULL === '1';
let rawLog = process.env.COPILOT_TEST_LOG_RAW === '1';

for (const arg of process.argv.slice(2)) {
    if (arg === '--full-output') {
        fullOutput = true;
        continue;
    }
    if (arg === '--raw-log') {
        rawLog = true;
        continue;
    }
    passthroughArgs.push(arg);
}

const artifactRoot = path.join(cwd, process.env.COPILOT_TEST_ARTIFACT_DIR || 'artifacts', 'test-runs', 'copilot');
const runId = new Date().toISOString().replace(/[.:]/gu, '-');
const runDir = path.join(artifactRoot, runId);
mkdirSync(runDir, { recursive: true });

const jsonReportPath = path.join(runDir, 'vitest-report.json');
const warningsLogPath = path.join(runDir, 'warnings.log');
const summaryJsonPath = path.join(runDir, 'summary.json');
const summaryMdPath = path.join(runDir, 'summary.md');
const rawLogPath = path.join(runDir, 'raw.log');

const warningsStream = createWriteStream(warningsLogPath, { encoding: 'utf8' });
const rawStream = rawLog ? createWriteStream(rawLogPath, { encoding: 'utf8' }) : null;
const maxLiveInterestingGroups = Math.max(0, Number(process.env.COPILOT_TEST_LIVE_GROUPS || 25));

/** @type {Map<string, InterestingLineStat>} */
const interestingLines = new Map();
/** @type {string[]} */
const tailLines = [];
let liveInterestingGroupsPrinted = 0;
let liveSuppressedNoticePrinted = false;

let stdoutBuffer = '';
let stderrBuffer = '';

/**
 * @param {string} line
 * @param {'stdout' | 'stderr'} stream
 * @returns {void}
 */
function processLine(line, stream) {
    pushRing(tailLines, `[${stream}] ${line}`, 120);
    const kind = classifyLine(line);
    if (!kind) return;

    const sample = summarizeLine(line);
    const key = `${kind}::${fingerprintLine(line)}`;
    const current = interestingLines.get(key);
    if (current) {
        current.count += 1;
        warningsStream.write(`[${stream}] ${sample}\n`);
        return;
    }

    interestingLines.set(key, { kind, sample, count: 1, stream });
    warningsStream.write(`[${stream}] ${sample}\n`);
    if (liveInterestingGroupsPrinted < maxLiveInterestingGroups) {
        const prefix = kind === 'warn' ? '[WARN]' : kind === 'error' ? '[ERROR]' : '[FAIL]';
        process.stderr.write(`${prefix} ${sample}\n`);
        liveInterestingGroupsPrinted += 1;
    } else if (!liveSuppressedNoticePrinted) {
        process.stderr.write(
            '[copilot:test] famílias adicionais de WARN/ERROR foram suprimidas no output ao vivo; consulte summary.md e warnings.log.\n',
        );
        liveSuppressedNoticePrinted = true;
    }
}

/**
 * @param {string} text
 * @param {'stdout' | 'stderr'} stream
 * @returns {void}
 */
function handleChunk(text, stream) {
    if (fullOutput) {
        const writer = stream === 'stderr' ? process.stderr : process.stdout;
        writer.write(text);
    }
    if (rawStream) rawStream.write(text);

    const buffer = `${stream === 'stdout' ? stdoutBuffer : stderrBuffer}${text}`;
    const lines = buffer.split(/\r?\n/u);
    const trailing = lines.pop() ?? '';

    if (stream === 'stdout') stdoutBuffer = trailing;
    else stderrBuffer = trailing;

    for (const line of lines) {
        processLine(line, stream);
    }
}

process.stdout.write(`[copilot:test] Vitest compacto iniciado · artifacts=${rel(runDir)}\n`);
if (!fullOutput) {
    process.stdout.write(
        '[copilot:test] modo compacto: exibindo WARN/ERROR/FAIL e resumo final; use --full-output para log completo ao vivo.\n',
    );
}

const childArgs = [
    'vitest',
    'run',
    '--config',
    'vitest.copilot.config.js',
    '--reporter=json',
    `--outputFile.json=${rel(jsonReportPath)}`,
    ...passthroughArgs,
];

const child = spawn(npxCommand, childArgs, {
    cwd,
    env: {
        ...process.env,
        NO_COLOR: '1',
    },
    stdio: ['inherit', 'pipe', 'pipe'],
});

child.stdout?.setEncoding('utf8');
child.stderr?.setEncoding('utf8');
child.stdout?.on('data', (chunk) => handleChunk(String(chunk), 'stdout'));
child.stderr?.on('data', (chunk) => handleChunk(String(chunk), 'stderr'));

const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
});

if (stdoutBuffer) processLine(stdoutBuffer, 'stdout');
if (stderrBuffer) processLine(stderrBuffer, 'stderr');

warningsStream.end();
rawStream?.end();

const exitCode = typeof result.code === 'number' ? result.code : 1;
const report = existsSync(jsonReportPath) ? JSON.parse(readFileSync(jsonReportPath, 'utf8')) : null;
const counts = summarizeCounts(report);
const failures = collectFailures(report);
const suiteFailures = collectSuiteFailures(report);
const totalInteresting = Array.from(interestingLines.values()).reduce((sum, item) => sum + item.count, 0);
const topWarnings = Array.from(interestingLines.values())
    .sort((a, b) => b.count - a.count || a.sample.localeCompare(b.sample))
    .slice(0, 12);
const startedAt = counts.startTime || Date.now();
const durationMs = Math.max(0, Date.now() - startedAt);
const reportClean =
    report !== null &&
    counts.numTotalTests > 0 &&
    counts.success &&
    failures.length === 0 &&
    suiteFailures.length === 0;
const success = reportClean || (exitCode === 0 && counts.success && failures.length === 0 && suiteFailures.length === 0);
const effectiveExitCode = success ? 0 : exitCode;

const summary = {
    runId,
    success,
    exitCode: effectiveExitCode,
    childExitCode: exitCode,
    signal: result.signal,
    durationMs,
    command: [npxCommand, ...childArgs].join(' '),
    artifacts: {
        directory: rel(runDir),
        jsonReport: rel(jsonReportPath),
        warningsLog: rel(warningsLogPath),
        summaryJson: rel(summaryJsonPath),
        summaryMarkdown: rel(summaryMdPath),
        rawLog: rawLog ? rel(rawLogPath) : null,
    },
    counts,
    interesting: {
        unique: interestingLines.size,
        total: totalInteresting,
        top: topWarnings,
    },
    failures,
    suiteFailures,
    tailLines: success ? [] : tailLines.slice(-25),
};

writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

const md = [
    `# Copilot test run — ${success ? 'PASS' : 'FAIL'}`,
    '',
    `- Run ID: \`${runId}\``,
    `- Exit code: \`${effectiveExitCode}\``,
    exitCode !== effectiveExitCode ? `- Child exit code: \`${exitCode}\`` : null,
    result.signal ? `- Signal: \`${String(result.signal)}\`` : null,
    `- Duration: \`${formatDuration(durationMs)}\``,
    `- Artifacts: \`${rel(runDir)}\``,
    '',
    '## Counts',
    '',
    `- Tests: total=${counts.numTotalTests}, passed=${counts.numPassedTests}, failed=${counts.numFailedTests}, pending=${counts.numPendingTests}, todo=${counts.numTodoTests}`,
    `- Suites: total=${counts.numTotalTestSuites}, passed=${counts.numPassedTestSuites}, failed=${counts.numFailedTestSuites}, pending=${counts.numPendingTestSuites}`,
    `- Interesting lines: unique=${interestingLines.size}, total=${totalInteresting}`,
    '',
    '## Top warnings/errors',
    '',
    ...(topWarnings.length > 0
        ? topWarnings.map((item) => `- [${item.kind.toUpperCase()} ×${item.count}] ${item.sample}`)
        : ['- none']),
    '',
    '## Failures',
    '',
    ...(suiteFailures.length > 0
        ? suiteFailures.flatMap((failure) => [
              `### Suite failure — ${failure.file}`,
              '',
              '```text',
              ...failure.message,
              '```',
              '',
          ])
        : []),
    ...(failures.length > 0
        ? failures.flatMap((failure) => [
              `### ${failure.fullName}`,
              '',
              `- File: \`${failure.file}\``,
              failure.location ? `- Location: line ${failure.location.line}, column ${failure.location.column}` : null,
              failure.durationMs !== null ? `- Duration: \`${failure.durationMs}ms\`` : null,
              '',
              '```text',
              ...failure.excerpt,
              '```',
              '',
          ])
        : ['- none', '']),
].filter((line) => line !== null);

writeFileSync(summaryMdPath, `${md.join('\n')}\n`, 'utf8');

process.stdout.write(`\n[copilot:test] ${success ? 'PASS' : 'FAIL'}\n`);
process.stdout.write(
    `[copilot:test] tests total=${counts.numTotalTests} passed=${counts.numPassedTests} failed=${counts.numFailedTests} pending=${counts.numPendingTests} todo=${counts.numTodoTests}\n`,
);
process.stdout.write(
    `[copilot:test] suites total=${counts.numTotalTestSuites} passed=${counts.numPassedTestSuites} failed=${counts.numFailedTestSuites} pending=${counts.numPendingTestSuites} · duration=${formatDuration(durationMs)}\n`,
);
process.stdout.write(
    `[copilot:test] warnings/errors unique=${interestingLines.size} total=${totalInteresting} · summary=${rel(summaryMdPath)}\n`,
);

if (topWarnings.length > 0) {
    process.stdout.write('[copilot:test] top warnings/errors:\n');
    for (const item of topWarnings) {
        process.stdout.write(`  - [${item.kind.toUpperCase()} ×${item.count}] ${item.sample}\n`);
    }
}

if (failures.length > 0) {
    process.stdout.write('[copilot:test] failed assertions:\n');
    for (const failure of failures) {
        const location = failure.location ? `:${failure.location.line}:${failure.location.column}` : '';
        process.stdout.write(`\n  • ${failure.fullName}\n`);
        process.stdout.write(`    file: ${failure.file}${location}\n`);
        for (const line of failure.excerpt) {
            process.stdout.write(`    ${line}\n`);
        }
    }

    if (suiteFailures.length > 0) {
        process.stdout.write('[copilot:test] failed suites without assertion failures:\n');
        for (const failure of suiteFailures) {
            process.stdout.write(`\n  • ${failure.file}\n`);
            for (const line of failure.message) {
                process.stdout.write(`    ${line}\n`);
            }
        }
    }
}

if (!success && report === null && tailLines.length > 0) {
    process.stdout.write('\n[copilot:test] tail bruto (fallback, sem JSON report):\n');
    for (const line of tailLines.slice(-20)) {
        process.stdout.write(`  ${line}\n`);
    }
}

process.exit(effectiveExitCode);
