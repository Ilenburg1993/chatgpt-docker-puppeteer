// @ts-check
/**
 * Gate leve para impedir drift conhecido entre documentação canônica, package metadata e paths reais de src/copilot.
 *
 * O checker é deliberadamente estreito: documentos históricos podem conter paths/versões antigas; apenas surfaces
 * canônicas ativas são avaliadas.
 *
 * @module copilot/mcp/scripts/docs-contract-check
 */

import { createWorkspaceReadIo } from '#copilot/infra/public/composition/workspace/read-io';
import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = MCP_WORKSPACE_ROOT;
const docsWorkspaceIo = createWorkspaceReadIo({ workspaceRoot: ROOT });
const ACTIVE_DOCS = Object.freeze([
    'src/copilot/README.md',
    'src/copilot/agent/README.md',
    'src/copilot/terminal/README.md',
    'src/copilot/sdk/README.md',
    'src/copilot/mcp/README.md',
    'src/copilot/docs/INDEX.md',
]);
const FORBIDDEN_ACTIVE_REFERENCES = Object.freeze([
    'presentation/agent-runtime.js',
    'presentation/runtime-ui-state-store.js',
]);

/**
 * @param {string} path
 * @returns {Promise<string>}
 */
async function readWorkspaceText(path) {
    return (await docsWorkspaceIo.readTextFresh(resolve(ROOT, path), { includeHash: false })).content;
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function pathExists(path) {
    try {
        await docsWorkspaceIo.statPath(resolve(ROOT, path));
        return true;
    } catch {
        return false;
    }
}

/**
 * @returns {Promise<{ success: boolean; checks: { name: string; passed: boolean; detail: string }[] }>}
 */
export async function runDocsContractCheck() {
    /** @type {{ name: string; passed: boolean; detail: string }[]} */
    const checks = [];

    const docs = new Map();
    for (const path of ACTIVE_DOCS) {
        const exists = await pathExists(path);
        checks.push({ name: `doc-exists:${path}`, passed: exists, detail: exists ? 'ok' : 'missing' });
        if (exists) docs.set(path, await readWorkspaceText(path));
    }

    for (const [path, content] of docs) {
        // INDEX.md documenta deliberadamente referências obsoletas como anti-regressão; não as trate como instrução ativa.
        if (path === 'src/copilot/docs/INDEX.md') continue;
        for (const forbidden of FORBIDDEN_ACTIVE_REFERENCES) {
            const passed = !content.includes(forbidden);
            checks.push({
                name: `no-obsolete-ref:${path}:${forbidden}`,
                passed,
                detail: passed ? 'ok' : `obsolete reference '${forbidden}' found`,
            });
        }
    }

    const gitignore = await readWorkspaceText('.gitignore');
    const gitignoreLines = gitignore.split(/\r?\n/u).map((line) => line.trim());
    const scopedPublic = gitignoreLines.includes('/public/');
    const globalPublic = gitignoreLines.includes('public/');
    checks.push({
        name: 'gitignore-public-is-root-scoped',
        passed: scopedPublic && !globalPublic,
        detail: `rootScoped=${scopedPublic} globalBare=${globalPublic}`,
    });

    const cacheCapabilityPaths = [
        'src/copilot/infra/public/cache/keys/index.js',
        'src/copilot/infra/public/cache/tiering/index.js',
        'src/copilot/infra/public/cache/ttl/index.js',
    ];
    const cacheCapabilityVisibility = await Promise.all(cacheCapabilityPaths.map((path) => pathExists(path)));
    const aggregateCacheFacadeAbsent = !(await pathExists('src/copilot/infra/public/cache/index.js'));
    checks.push({
        name: 'infra-public-cache-capabilities-are-exact',
        passed: cacheCapabilityVisibility.every(Boolean) && aggregateCacheFacadeAbsent,
        detail: `exactLeaves=${cacheCapabilityVisibility.filter(Boolean).length}/${cacheCapabilityPaths.length} aggregateFacadeAbsent=${aggregateCacheFacadeAbsent}`,
    });

    const lock = JSON.parse(await readWorkspaceText('package-lock.json'));
    const installedSdkVersion = lock?.packages?.['node_modules/@github/copilot-sdk']?.version;
    const sdkReadme = docs.get('src/copilot/sdk/README.md') ?? '';
    const sdkVersionDocumented =
        typeof installedSdkVersion === 'string' && sdkReadme.includes(`@github/copilot-sdk@${installedSdkVersion}`);
    checks.push({
        name: 'sdk-readme-matches-installed-version',
        passed: sdkVersionDocumented,
        detail: `installed=${String(installedSdkVersion ?? 'unknown')}`,
    });

    const mcpReadme = docs.get('src/copilot/mcp/README.md') ?? '';
    const canonicalOriginDocumented =
        mcpReadme.includes('https://127.0.0.1:3333') && mcpReadme.includes('http2Origin=true');
    checks.push({
        name: 'mcp-readme-documents-canonical-h2-origin',
        passed: canonicalOriginDocumented,
        detail: canonicalOriginDocumented ? 'https+h2 origin documented' : 'canonical origin contract missing',
    });

    const success = checks.every((check) => check.passed);
    return { success, checks };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const report = await runDocsContractCheck();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.success) process.exitCode = 1;
}
