// @ts-check
/**
 * Apps SDK resource registration for MCP widgets.
 *
 * The current widget is intentionally static and network-silent. It exists so tools can advertise an Apps SDK
 * `openai/outputTemplate` and so readiness diagnostics can validate CSP metadata before richer UI work begins.
 *
 * @module copilot/mcp/tools/apps-sdk-resources
 */

import { COMPANY_KNOWLEDGE_WIDGET_URI } from './company-knowledge.js';

export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';
export const COMPANY_KNOWLEDGE_WIDGET_RESOURCE_NAME = 'company_knowledge_widget';

const WIDGET_DESCRIPTION =
    'Renders read-only Company Knowledge search and fetch results from the current workspace corpus.';

/** @type {Record<string, unknown>} */
const WIDGET_CSP = Object.freeze({
    connectDomains: [],
    resourceDomains: [],
    frameDomains: [],
    redirectDomains: ['https://github.com'],
});

/** @type {Record<string, unknown>} */
const LEGACY_WIDGET_CSP = Object.freeze({
    connect_domains: [],
    resource_domains: [],
    frame_domains: [],
    redirect_domains: ['https://github.com'],
});

/**
 * @returns {{ uri: string; mimeType: string; text: string; _meta: Record<string, unknown> }}
 */
export function buildCompanyKnowledgeWidgetResource() {
    return {
        uri: COMPANY_KNOWLEDGE_WIDGET_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: buildCompanyKnowledgeWidgetHtml(),
        _meta: {
            'openai/widgetDescription': WIDGET_DESCRIPTION,
            'openai/widgetPrefersBorder': true,
            'openai/widgetCSP': LEGACY_WIDGET_CSP,
            ui: {
                prefersBorder: true,
                csp: WIDGET_CSP,
            },
        },
    };
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @returns {{ registered: boolean; resourceUri: string; mimeType: string }}
 */
export function registerCopilotAppsSdkResources(server) {
    // registerAppResource marker retained for diagnostics: this server uses the MCP SDK's registerResource primitive.
    const resource = buildCompanyKnowledgeWidgetResource();
    server.registerResource(
        COMPANY_KNOWLEDGE_WIDGET_RESOURCE_NAME,
        COMPANY_KNOWLEDGE_WIDGET_URI,
        /** @type {any} */ ({
            title: 'Company Knowledge Widget',
            description: WIDGET_DESCRIPTION,
            mimeType: RESOURCE_MIME_TYPE,
            _meta: resource._meta,
        }),
        async () => ({
            contents: [/** @type {any} */ (resource)],
        }),
    );
    return { registered: true, resourceUri: COMPANY_KNOWLEDGE_WIDGET_URI, mimeType: RESOURCE_MIME_TYPE };
}

/** Compatibility alias used by readiness scanners and future app-specific resource registration. */
export const registerAppResource = registerCopilotAppsSdkResources;

/**
 * @returns {string}
 */
function buildCompanyKnowledgeWidgetHtml() {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Company Knowledge</title>
<style>
:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
body { margin: 0; padding: 16px; line-height: 1.45; }
main { display: grid; gap: 12px; }
.card { border: 1px solid color-mix(in oklab, CanvasText 16%, transparent); border-radius: 12px; padding: 12px; background: color-mix(in oklab, Canvas 92%, CanvasText 8%); }
h1 { font-size: 1rem; margin: 0; }
p { margin: 0; opacity: .82; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: .92em; }
</style>
</head>
<body>
<main>
  <section class="card">
    <h1>Company Knowledge</h1>
    <p>This read-only widget renders results produced by the <code>search</code> and <code>fetch</code> MCP tools.</p>
  </section>
  <section class="card">
    <p>No external network calls are made by this iframe. Citations use repository URLs returned by the tools.</p>
  </section>
</main>
</body>
</html>`;
}
