// @ts-check
/**
 * Apps SDK readiness diagnostics for this MCP server.
 *
 * @module copilot/mcp/tools/apps-sdk-readiness
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { getMcpWorkspaceRoot, okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/** @type {Record<string, string>} */
const MARKERS = {
    appResource: 'registerAppResource',
    appMime: 'text/html;profile=mcp-app',
    resourceMimeType: 'RESOURCE_MIME_TYPE',
    uiCsp: 'ui: {',
    csp: 'csp:',
    connectDomains: 'connectDomains',
    resourceDomains: 'resourceDomains',
    frameDomains: 'frameDomains',
    widgetDescription: 'openai/widgetDescription',
    outputTemplate: 'openai/outputTemplate',
};

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listJsFiles(directory) {
    /** @type {string[]} */
    const files = [];
    /**
     * @param {string} current
     * @param {number} depth
     * @returns {Promise<void>}
     */
    async function walk(current, depth) {
        if (depth > 8) return;
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                await walk(fullPath, depth + 1);
                continue;
            }
            if (entry.isFile() && entry.name === 'apps-sdk-readiness.js') continue;
            if (entry.isFile() && /\.[cm]?[jt]s$/.test(entry.name)) files.push(fullPath);
        }
    }
    await walk(directory, 0);
    return files;
}

/**
 * @param {string[]} files
 * @returns {Promise<Record<string, string[]>>}
 */
async function scanMarkers(files) {
    /** @type {Record<string, string[]>} */
    const found = {};
    for (const [key] of Object.entries(MARKERS)) found[key] = [];
    for (const file of files) {
        const stats = await stat(file);
        if (stats.size > 512 * 1024) continue;
        const text = await readFile(file, 'utf8');
        for (const [key, marker] of Object.entries(MARKERS)) {
            const matches = found[key] ?? [];
            if (text.includes(marker)) matches.push(path.relative(getMcpWorkspaceRoot(), file));
            found[key] = matches;
        }
    }
    return found;
}

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpAppsSdkReadinessTool = {
    name: 'mcp_apps_sdk_readiness',
    title: 'MCP Apps SDK readiness',
    description:
        'Inspect this MCP server for Apps SDK widget/CSP metadata, Company Knowledge search/fetch readiness, and prompt-friction implications.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const root = getMcpWorkspaceRoot();
        const mcpDir = path.join(root, 'src/copilot/mcp');
        const files = await listJsFiles(mcpDir);
        const found = await scanMarkers(files);
        const hasWidgetResource =
            (found['appResource'] ?? []).length > 0 ||
            (found['appMime'] ?? []).length > 0 ||
            (found['resourceMimeType'] ?? []).length > 0;
        const hasCsp =
            (found['connectDomains'] ?? []).length > 0 ||
            (found['resourceDomains'] ?? []).length > 0 ||
            (found['csp'] ?? []).length > 0;
        const hasFrameDomains = (found['frameDomains'] ?? []).length > 0;
        const hasWidgetDescription = (found['widgetDescription'] ?? []).length > 0;
        return okResult({
            success: true,
            scannedFiles: files.length,
            appsSdk: {
                hasWidgetResource,
                cspApplicable: hasWidgetResource,
                hasCsp,
                hasFrameDomains,
                hasWidgetDescription,
                markerFiles: found,
            },
            promptFrictionImpact: hasWidgetResource
                ? 'Widget CSP affects iframe/network behavior and review readiness, not host confirmation for MCP write tool calls.'
                : 'No Apps SDK widget resource detected; CSP is not a current source of tool-call approval prompts.',
            companyKnowledge: {
                searchFetchToolsDetected: false,
                note: 'Company Knowledge requires exact search/fetch tool shapes; this repo MCP currently exposes repo-specific read tools instead.',
            },
            recommendedActions: [
                hasWidgetResource ? 'Keep _meta.ui.csp explicit for every widget resource.' : 'Do not spend prompt-friction time on CSP until a widget resource is added.',
                hasWidgetResource && !hasWidgetDescription
                    ? 'Add openai/widgetDescription to reduce redundant widget narration.'
                    : 'Keep descriptions concise and tool-focused.',
                'Continue reducing approval prompts through readOnlyHint, plan tools, batched writes, and remembered approvals for bounded-write tools.',
            ],
        });
    },
};
