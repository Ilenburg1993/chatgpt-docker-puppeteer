#!/usr/bin/env node
// @ts-check
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

const PACKAGE_METADATA_CACHE = new Map();
const PUBLISHED_VERSION_CACHE = new Map();
const TARBALL_CHECK_CACHE = new Map();

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
        const _ce = /** @type {any} */ (error);
        return {
            stdout: typeof _ce.stdout === 'string' ? _ce.stdout : '',
            stderr: typeof _ce.stderr === 'string' ? _ce.stderr : String(_ce.message || ''),
            exitCode: typeof _ce.code === 'number' ? _ce.code : 1,
        };
    }
}

/**
 * @param {string} body
 * @returns {any | null}
 */
function tryParseJson(body) {
    try {
        return JSON.parse(body);
    } catch {
        return null;
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
 * @returns {{ name: string, version: string } | null}
 */
function parseExactPackageSpec(spec) {
    const separatorIndex = spec.lastIndexOf('@');
    if (separatorIndex <= 0) {
        return null;
    }
    const name = spec.slice(0, separatorIndex).trim();
    const version = spec.slice(separatorIndex + 1).trim();
    if (!name || !version) {
        return null;
    }
    if (/[<>=~^*| ]/.test(version)) {
        return null;
    }
    return { name, version };
}

/**
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
async function npmViewJson(args) {
    return execJsonCapable('npm', ['view', ...args, '--json', '--prefer-online']);
}

/**
 * @param {string} packageName
 * @returns {Promise<{ versions: Set<string>, time: Record<string, unknown> } | null>}
 */
async function getPackageRegistryMetadata(packageName) {
    if (PACKAGE_METADATA_CACHE.has(packageName)) {
        return PACKAGE_METADATA_CACHE.get(packageName);
    }

    const response = await npmViewJson([packageName, 'versions', 'time']);
    if (response.exitCode !== 0) {
        PACKAGE_METADATA_CACHE.set(packageName, null);
        return null;
    }

    const parsed = tryParseJson(response.stdout.trim());
    if (!parsed || typeof parsed !== 'object') {
        PACKAGE_METADATA_CACHE.set(packageName, null);
        return null;
    }

    const versions = Array.isArray(parsed.versions)
        ? parsed.versions.filter((/** @type {string} */ version) => typeof version === 'string' && version.length > 0)
        : [];
    const time =
        parsed.time && typeof parsed.time === 'object' ? /** @type {Record<string, unknown>} */ (parsed.time) : {};
    const metadata = { versions: new Set(versions), time };
    PACKAGE_METADATA_CACHE.set(packageName, metadata);
    return metadata;
}

/**
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function isReachableTarball(url) {
    if (!url) {
        return false;
    }
    if (TARBALL_CHECK_CACHE.has(url)) {
        return TARBALL_CHECK_CACHE.get(url);
    }

    /** @type {boolean} */
    let reachable = false;
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(5000),
        });
        reachable = response.ok;
    } catch {
        reachable = false;
    }

    TARBALL_CHECK_CACHE.set(url, reachable);
    return reachable;
}

/**
 * @param {string} spec
 * @returns {Promise<boolean>}
 */
async function isPublishedVersion(spec) {
    if (PUBLISHED_VERSION_CACHE.has(spec)) {
        return PUBLISHED_VERSION_CACHE.get(spec);
    }

    const parsedSpec = parseExactPackageSpec(spec);
    if (!parsedSpec) {
        PUBLISHED_VERSION_CACHE.set(spec, false);
        return false;
    }

    const [packument, manifestResponse] = await Promise.all([
        getPackageRegistryMetadata(parsedSpec.name),
        npmViewJson([spec, 'version', 'dist.tarball']),
    ]);

    const manifest = manifestResponse.exitCode === 0 ? tryParseJson(manifestResponse.stdout.trim()) : null;
    const listed = Boolean(packument?.versions.has(parsedSpec.version));
    const timed = typeof packument?.time?.[parsedSpec.version] === 'string';
    const exactVersion = manifest?.version;
    const tarball = manifest?.['dist.tarball'];
    const tarballReachable =
        typeof tarball === 'string' && tarball.length > 0 ? await isReachableTarball(tarball) : false;
    const published = listed && timed && exactVersion === parsedSpec.version && tarballReachable;

    PUBLISHED_VERSION_CACHE.set(spec, published);
    return published;
}

/**
 * @typedef {object} ClassifyVulnerabilityVulnerability
 * @property {string} name
 * @property {string} severity
 * @property {boolean | { name?: string; version?: string; isSemVerMajor?: boolean }} [fixAvailable]
 * @property {string} [version]
 * @property {boolean} [isSemVerMajor]
 * @property {unknown} [via]
 * @property {string[]} [nodes]
 * @property {boolean} [isDirect]
 */
/**
 * @param {ClassifyVulnerabilityVulnerability} vulnerability
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

    return {
        state: 'manual-review',
        candidates: [...candidates].map(version => `${vulnerability.name}@${version}`),
        note: 'O advisory só expõe um limite semver inferido; sem versão explícita do npm audit, o finding exige revisão manual e não bloqueia automaticamente.',
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

/** @type {{ vulnerabilities?: Record<string, unknown>, metadata?: unknown }} */
let payload;
try {
    payload = JSON.parse(auditResult.stdout);
} catch (error) {
    console.error('Falha ao interpretar JSON do npm audit.');
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(2);
}

const rawVulnerabilities = /** @type {any[]} */ (Object.values(payload.vulnerabilities || {}));
const filtered = rawVulnerabilities.filter(item => {
    const severity = String(item?.severity || 'info');
    return (
        /** @type {any} */ ((SEVERITY_RANK)[severity] ?? 0) >= /** @type {any} */ (SEVERITY_RANK)[options.minSeverity]
    );
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
