#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const SEVERITY_RANK = {
    info: 0,
    low: 1,
    moderate: 2,
    high: 3,
    critical: 4,
};

/**
 * @param {string[]} argv
 * @returns {{
 *   omitDev: boolean,
 *   minSeverity: keyof typeof SEVERITY_RANK,
 *   reportFile: string | null,
 *   markdownFile: string | null,
 * }}
 */
function parseArgs(argv) {
    /** @type {{
     *   omitDev: boolean,
     *   minSeverity: keyof typeof SEVERITY_RANK,
     *   reportFile: string | null,
     *   markdownFile: string | null,
     * }} */
    const options = {
        omitDev: false,
        minSeverity: 'high',
        reportFile: null,
        markdownFile: null,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--omit=dev' || arg === '--omit-dev') {
            options.omitDev = true;
            continue;
        }
        if (arg === '--min-severity') {
            const value = argv[index + 1];
            if (value && value in SEVERITY_RANK) {
                options.minSeverity = /** @type {keyof typeof SEVERITY_RANK} */ (value);
                index += 1;
            }
            continue;
        }
        if (arg.startsWith('--min-severity=')) {
            const value = arg.slice('--min-severity='.length);
            if (value in SEVERITY_RANK) {
                options.minSeverity = /** @type {keyof typeof SEVERITY_RANK} */ (value);
            }
            continue;
        }
        if (arg === '--report-file') {
            options.reportFile = argv[index + 1] || null;
            if (options.reportFile) {
                index += 1;
            }
            continue;
        }
        if (arg.startsWith('--report-file=')) {
            options.reportFile = arg.slice('--report-file='.length) || null;
            continue;
        }
        if (arg === '--markdown-file') {
            options.markdownFile = argv[index + 1] || null;
            if (options.markdownFile) {
                index += 1;
            }
            continue;
        }
        if (arg.startsWith('--markdown-file=')) {
            options.markdownFile = arg.slice('--markdown-file='.length) || null;
        }
    }

    return options;
}

/**
 * @template T
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
async function execJsonCapable(command, args) {
    try {
        const result = await execFile(command, args, {
            cwd: process.cwd(),
            maxBuffer: 10 * 1024 * 1024,
            env: process.env,
        });
        return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error) {
        return {
            stdout: typeof error.stdout === 'string' ? error.stdout : '',
            stderr: typeof error.stderr === 'string' ? error.stderr : String(error.message || ''),
            exitCode: typeof error.code === 'number' ? error.code : 1,
        };
    }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function inferExclusiveFixCandidates(text) {
    const candidates = new Set();
    const tokens = String(text || '')
        .split(/\s+/)
        .map(token => token.trim())
        .filter(Boolean);

    for (const token of tokens) {
        if (token.startsWith('<') && !token.startsWith('<=')) {
            candidates.add(token.slice(1));
        }
    }

    return [...candidates].filter(Boolean);
}

/**
 * @param {unknown} value
 * @returns {Array<{name?: string, url?: string, severity?: string, range?: string, title?: string}>}
 */
function normalizeViaEntries(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(item => item && typeof item === 'object');
}

/**
 * @param {string} spec
 * @returns {Promise<boolean>}
 */
async function isPublishedVersion(spec) {
    const response = await execJsonCapable('npm', ['view', spec, 'version', '--json']);
    if (response.exitCode !== 0) {
        return false;
    }
    const body = response.stdout.trim();
    if (!body) {
        return false;
    }
    try {
        const parsed = JSON.parse(body);
        return typeof parsed === 'string' && parsed.length > 0;
    } catch {
        return false;
    }
}

/**
 * @param {{
 *   name: string,
 *   severity: string,
 *   fixAvailable?: boolean | { name?: string, version?: string, isSemVerMajor?: boolean },
 *   via?: unknown,
 *   nodes?: string[],
 *   isDirect?: boolean,
 * }} vulnerability
 * @returns {Promise<{
 *   state: 'actionable' | 'unpublished-fix' | 'no-fix' | 'manual-review',
 *   candidates: string[],
 *   note: string,
 * }>}
 */
async function classifyVulnerability(vulnerability) {
    const fixAvailable = vulnerability.fixAvailable;

    if (fixAvailable === false) {
        return {
            state: 'no-fix',
            candidates: [],
            note: 'npm audit reporta que não há correção publicada.',
        };
    }

    if (fixAvailable && typeof fixAvailable === 'object') {
        const packageName = fixAvailable.name || vulnerability.name;
        const version = fixAvailable.version;
        if (!packageName || !version) {
            return {
                state: 'manual-review',
                candidates: [],
                note: 'npm audit sinalizou correção, mas sem versão explícita utilizável.',
            };
        }
        const spec = `${packageName}@${version}`;
        const published = await isPublishedVersion(spec);
        if (published && fixAvailable.isSemVerMajor) {
            return {
                state: 'manual-review',
                candidates: [spec],
                note: 'Existe correção publicada, mas ela exige mudança semver major e revisão explícita.',
            };
        }
        return published
            ? {
                  state: 'actionable',
                  candidates: [spec],
                  note: 'Existe versão publicada no registry para a correção sugerida pelo npm audit.',
              }
            : {
                  state: 'unpublished-fix',
                  candidates: [spec],
                  note: 'O npm audit sugere uma correção, mas a versão indicada não existe no registry neste momento.',
              };
    }

    const viaEntries = normalizeViaEntries(vulnerability.via);
    const candidates = new Set();
    for (const entry of viaEntries) {
        for (const candidate of inferExclusiveFixCandidates(entry.range || '')) {
            candidates.add(candidate);
        }
    }

    if (candidates.size === 0) {
        return {
            state: 'manual-review',
            candidates: [],
            note: 'O npm audit indica que há correção, mas não expõe uma versão exata publicável.',
        };
    }

    /** @type {string[]} */
    const publishedSpecs = [];
    for (const version of candidates) {
        const spec = `${vulnerability.name}@${version}`;
        if (await isPublishedVersion(spec)) {
            publishedSpecs.push(spec);
        }
    }

    if (publishedSpecs.length > 0) {
        return {
            state: 'actionable',
            candidates: publishedSpecs,
            note: 'Existe pelo menos uma versão de correção publicada para o pacote afetado.',
        };
    }

    return {
        state: 'unpublished-fix',
        candidates: [...candidates].map(version => `${vulnerability.name}@${version}`),
        note: 'O advisory aponta versões de saída, mas nenhuma delas está publicada no registry.',
    };
}

/**
 * @param {string | null} targetPath
 * @param {string} content
 */
async function writeOptionalFile(targetPath, content) {
    if (!targetPath) {
        return;
    }
    const absolute = path.resolve(process.cwd(), targetPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, 'utf8');
}

const options = parseArgs(process.argv.slice(2));
const auditArgs = ['audit', '--json'];
if (options.omitDev) {
    auditArgs.push('--omit=dev');
}

const auditResult = await execJsonCapable('npm', auditArgs);
if (!auditResult.stdout.trim()) {
    console.error('npm audit não retornou JSON utilizável.');
    process.exit(2);
}

/** @type {{ vulnerabilities?: Record<string, any>, metadata?: any }} */
let payload;
try {
    payload = JSON.parse(auditResult.stdout);
} catch (error) {
    console.error('Falha ao interpretar JSON do npm audit.');
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(2);
}

const rawVulnerabilities = Object.values(payload.vulnerabilities || {});
const filtered = rawVulnerabilities.filter(item => {
    const severity = String(item?.severity || 'info');
    return (SEVERITY_RANK[severity] ?? 0) >= SEVERITY_RANK[options.minSeverity];
});

/** @type {Array<Record<string, unknown>>} */
const actionable = [];
/** @type {Array<Record<string, unknown>>} */
const residual = [];

for (const vulnerability of filtered) {
    const assessment = await classifyVulnerability(vulnerability);
    const record = {
        name: vulnerability.name,
        severity: vulnerability.severity,
        direct: Boolean(vulnerability.isDirect),
        nodes: Array.isArray(vulnerability.nodes) ? vulnerability.nodes.length : 0,
        candidates: assessment.candidates,
        state: assessment.state,
        note: assessment.note,
        advisories: normalizeViaEntries(vulnerability.via).map(item => ({
            title: item.title || null,
            url: item.url || null,
            range: item.range || null,
            severity: item.severity || null,
        })),
    };

    if (assessment.state === 'actionable') {
        actionable.push(record);
    } else {
        residual.push(record);
    }
}

const summary = {
    timestamp: new Date().toISOString(),
    options,
    auditExitCode: auditResult.exitCode,
    metadata: payload.metadata || null,
    filteredCount: filtered.length,
    actionableCount: actionable.length,
    residualCount: residual.length,
    actionable,
    residual,
};

const markdownLines = [
    '# NPM Audit Gate',
    '',
    `- omit_dev: ${options.omitDev}`,
    `- min_severity: ${options.minSeverity}`,
    `- filtered_vulnerabilities: ${filtered.length}`,
    `- actionable: ${actionable.length}`,
    `- residual: ${residual.length}`,
    '',
];

if (actionable.length > 0) {
    markdownLines.push('## Blocking (published fix exists)', '');
    for (const item of actionable) {
        markdownLines.push(
            `- ${item.name} (${item.severity}) -> ${Array.isArray(item.candidates) ? item.candidates.join(', ') : 'n/a'}`
        );
    }
    markdownLines.push('');
}

if (residual.length > 0) {
    markdownLines.push('## Residual (no published fix / manual review)', '');
    for (const item of residual) {
        markdownLines.push(`- ${item.name} (${item.severity}) -> ${item.state}: ${item.note}`);
    }
    markdownLines.push('');
}

await writeOptionalFile(options.reportFile, `${JSON.stringify(summary, null, 2)}\n`);
await writeOptionalFile(options.markdownFile, `${markdownLines.join('\n')}\n`);

console.log(JSON.stringify(summary, null, 2));

if (actionable.length > 0) {
    process.exit(1);
}
