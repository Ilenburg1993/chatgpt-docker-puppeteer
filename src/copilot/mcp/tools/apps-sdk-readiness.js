// @ts-check
/**
 * Apps SDK readiness diagnostics for this MCP server.
 *
 * @module copilot/mcp/tools/apps-sdk-readiness
 */

import { getMcpWorkspaceIo, getMcpWorkspaceRoot, okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';
import path from 'node:path';
import { buildCompanyKnowledgeWidgetResource } from './apps-sdk-resources.js';
import {
    COMPANY_KNOWLEDGE_FETCH_TOOL_NAME,
    COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME,
    companyKnowledgeTools,
} from './company-knowledge.js';

const appsSdkWorkspaceIo = getMcpWorkspaceIo();

/** @type {Record<string, string>} */
const MARKERS = {
    appResource: 'registerAppResource',
    appResourceRegistrar: 'registerCopilotAppsSdkResources',
    appMime: 'text/html;profile=mcp-app',
    resourceMimeType: 'RESOURCE_MIME_TYPE',
    uiCsp: 'ui: {',
    csp: 'csp:',
    connectDomains: 'connectDomains',
    resourceDomains: 'resourceDomains',
    frameDomains: 'frameDomains',
    widgetDescription: 'openai/widgetDescription',
    widgetDomain: 'openai/widgetDomain',
    uiDomain: 'domain: widgetDomain',
    resourceUri: 'resourceUri',
    outputTemplate: 'openai/outputTemplate',
    companySearchTool: "COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME = 'search'",
    companyFetchTool: "COMPANY_KNOWLEDGE_FETCH_TOOL_NAME = 'fetch'",
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
        const entries = (await appsSdkWorkspaceIo.listDirectoryNamesFresh(current)).entries;
        for (const entryName of entries) {
            const fullPath = path.join(current, entryName);
            const info = (await appsSdkWorkspaceIo.lstatPath(fullPath)).stats;
            if (info.isSymbolicLink()) continue;
            if (info.isDirectory()) {
                if (entryName === 'node_modules' || entryName === '.git') continue;
                await walk(fullPath, depth + 1);
                continue;
            }
            if (info.isFile() && entryName === 'apps-sdk-readiness.js') continue;
            if (info.isFile() && /\.[cm]?[jt]s$/.test(entryName)) files.push(fullPath);
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
        const stats = (await appsSdkWorkspaceIo.statPath(file)).stats;
        if (stats.size > 512 * 1024) continue;
        const text = (await appsSdkWorkspaceIo.readTextFresh(file, { includeHash: false })).content;
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
            (found['appResourceRegistrar'] ?? []).length > 0 ||
            (found['appMime'] ?? []).length > 0 ||
            (found['resourceMimeType'] ?? []).length > 0;
        const hasCsp =
            (found['connectDomains'] ?? []).length > 0 ||
            (found['resourceDomains'] ?? []).length > 0 ||
            (found['csp'] ?? []).length > 0;
        const hasFrameDomains = (found['frameDomains'] ?? []).length > 0;
        const hasWidgetDescription = (found['widgetDescription'] ?? []).length > 0;
        const resource = buildCompanyKnowledgeWidgetResource();
        const resourceMeta = recordOrEmpty(resource._meta);
        const uiMeta = recordOrEmpty(resourceMeta['ui']);
        const widgetDomain = typeof uiMeta['domain'] === 'string' ? uiMeta['domain'] : null;
        const legacyWidgetDomain =
            typeof resourceMeta['openai/widgetDomain'] === 'string' ? resourceMeta['openai/widgetDomain'] : null;
        const hasWidgetDomain = isHttpsOrigin(widgetDomain);
        const widgetDomainAliasesMatch = hasWidgetDomain && legacyWidgetDomain === widgetDomain;
        const searchTool = companyKnowledgeTools.find((tool) => tool.name === COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME);
        const fetchTool = companyKnowledgeTools.find((tool) => tool.name === COMPANY_KNOWLEDGE_FETCH_TOOL_NAME);
        const searchFetchToolsDetected = Boolean(searchTool && fetchTool);
        const hasStandardResourceUri = [searchTool, fetchTool].every((tool) => {
            const toolMeta = recordOrEmpty(tool?._meta);
            return recordOrEmpty(toolMeta['ui'])['resourceUri'] === resource.uri;
        });
        const hasLegacyOutputTemplate = [searchTool, fetchTool].every(
            (tool) => recordOrEmpty(tool?._meta)['openai/outputTemplate'] === resource.uri,
        );
        const submissionReady =
            hasWidgetResource &&
            hasCsp &&
            hasWidgetDomain &&
            widgetDomainAliasesMatch &&
            hasStandardResourceUri &&
            hasLegacyOutputTemplate;
        return okResult({
            success: true,
            scannedFiles: files.length,
            appsSdk: {
                hasWidgetResource,
                cspApplicable: hasWidgetResource,
                hasCsp,
                hasFrameDomains,
                hasWidgetDescription,
                hasWidgetDomain,
                widgetDomain,
                widgetDomainAliasesMatch,
                hasStandardResourceUri,
                hasLegacyOutputTemplate,
                submissionReady,
                markerFiles: found,
            },
            promptFrictionImpact: hasWidgetResource
                ? 'Widget CSP affects iframe/network behavior and review readiness, not host confirmation for MCP write tool calls.'
                : 'No Apps SDK widget resource detected; CSP is not a current source of tool-call approval prompts.',
            companyKnowledge: {
                searchFetchToolsDetected,
                toolNames: searchFetchToolsDetected ? ['search', 'fetch'] : [],
                outputCompatibility: searchFetchToolsDetected
                    ? 'structuredContent plus JSON content text'
                    : 'not-ready',
                note: searchFetchToolsDetected
                    ? 'Company Knowledge exact search/fetch tools are present and read-only.'
                    : 'Company Knowledge requires exact search/fetch tool shapes; this repo MCP currently exposes repo-specific read tools instead.',
            },
            recommendedActions: [
                hasWidgetResource
                    ? 'Keep _meta.ui.csp explicit for every widget resource.'
                    : 'Do not spend prompt-friction time on CSP until a widget resource is added.',
                hasWidgetResource && !hasWidgetDomain
                    ? 'Add a dedicated HTTPS _meta.ui.domain plus matching openai/widgetDomain before plugin submission.'
                    : widgetDomainAliasesMatch
                      ? 'Keep the widget domain dedicated to this plugin and verify the production domain before submission.'
                      : 'Make _meta.ui.domain and openai/widgetDomain identical.',
                hasWidgetResource && !hasStandardResourceUri
                    ? 'Link UI tools with _meta.ui.resourceUri; keep openai/outputTemplate only as a compatibility alias.'
                    : 'Standard MCP Apps resource linkage is present.',
                hasWidgetResource && !hasWidgetDescription
                    ? 'Add openai/widgetDescription to reduce redundant widget narration.'
                    : 'Keep descriptions concise and tool-focused.',
                'Continue reducing approval prompts through readOnlyHint, plan tools, batched writes, and remembered approvals for bounded-write tools.',
            ],
        });
    },
};

/** @param {unknown} value */
function recordOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/** @param {unknown} value */
function isHttpsOrigin(value) {
    if (typeof value !== 'string' || !value) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' && parsed.origin === value && parsed.pathname === '/';
    } catch {
        return false;
    }
}
