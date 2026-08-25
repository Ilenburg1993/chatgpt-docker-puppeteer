// @ts-check
/**
 * Apps SDK resource registration for MCP widgets.
 *
 * The current widget is intentionally static and network-silent. It exists so tools can advertise an Apps SDK
 * `openai/outputTemplate` and so readiness diagnostics can validate CSP metadata before richer UI work begins.
 *
 * @module copilot/mcp/protocol/apps-sdk/resources
 */

import { resolveCompanyKnowledgeProcessConfig } from '#copilot/mcp/public/company-knowledge';

export const COMPANY_KNOWLEDGE_WIDGET_URI = 'ui://copilot/company-knowledge/v2.html';

export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';
export const COMPANY_KNOWLEDGE_WIDGET_RESOURCE_NAME = 'company_knowledge_widget';

const WIDGET_DESCRIPTION =
    'Renders read-only Company Knowledge search and fetch results from the current workspace corpus.';
/** @type {Record<string, unknown>} */
const WIDGET_CSP = Object.freeze({
    connectDomains: [],
    resourceDomains: [],
    frameDomains: [],
});

/** @type {Record<string, unknown>} */
const LEGACY_WIDGET_CSP = Object.freeze({
    connect_domains: [],
    resource_domains: [],
    frame_domains: [],
    redirect_domains: ['https://github.com'],
});

/**
 * Resolve the dedicated HTTPS origin used by the MCP Apps iframe from one Company Knowledge generation.
 *
 * @param {import('#copilot/mcp/public/company-knowledge').CompanyKnowledgeProcessConfig | NodeJS.ProcessEnv | undefined} [input]
 * @returns {string}
 */
export function readCompanyKnowledgeWidgetDomain(input = undefined) {
    return resolveCompanyKnowledgeProcessConfig(input).widgetDomain;
}

/**
 * @param {import('#copilot/mcp/public/company-knowledge').CompanyKnowledgeProcessConfig | NodeJS.ProcessEnv | undefined} [input]
 * @returns {{ uri: string; mimeType: string; text: string; _meta: Record<string, unknown> }}
 */
export function buildCompanyKnowledgeWidgetResource(input = undefined) {
    const widgetDomain = readCompanyKnowledgeWidgetDomain(input);
    return {
        uri: COMPANY_KNOWLEDGE_WIDGET_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: buildCompanyKnowledgeWidgetHtml(),
        _meta: {
            'openai/widgetDescription': WIDGET_DESCRIPTION,
            'openai/widgetPrefersBorder': true,
            'openai/widgetCSP': LEGACY_WIDGET_CSP,
            'openai/widgetDomain': widgetDomain,
            ui: {
                prefersBorder: true,
                domain: widgetDomain,
                csp: WIDGET_CSP,
            },
        },
    };
}

/**
 * @param {import('@modelcontextprotocol/server').McpServer} server
 * @param {import('#copilot/mcp/public/company-knowledge').CompanyKnowledgeProcessConfig | undefined} [config]
 * @returns {{ registered: boolean; resourceUri: string; mimeType: string }}
 */
export function registerCopilotAppsSdkResources(server, config = undefined) {
    // registerAppResource marker retained for diagnostics: this server uses the MCP SDK's registerResource primitive.
    const resource = buildCompanyKnowledgeWidgetResource(config);
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
h1, h2 { margin: 0; line-height: 1.25; }
h1 { font-size: 1rem; }
h2 { font-size: .96rem; }
p { margin: 0; opacity: .82; }
ul { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
li { display: grid; gap: 3px; }
a { color: LinkText; overflow-wrap: anywhere; }
pre { margin: 0; max-height: 360px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: .84rem/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
.meta { font-size: .78rem; opacity: .68; overflow-wrap: anywhere; }
.empty { opacity: .68; }
</style>
</head>
<body>
<main>
  <section class="card">
    <h1>Company Knowledge</h1>
    <p>Read-only results from the bounded workspace corpus.</p>
  </section>
  <section id="content" class="card" aria-live="polite">
    <p class="empty">Waiting for a <code>search</code> or <code>fetch</code> result.</p>
  </section>
</main>
<script>
(function () {
  const content = document.getElementById("content");
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function safeHttpsUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      return parsed.protocol === "https:" ? parsed.href : null;
    } catch {
      return null;
    }
  }
  function appendHttpsLink(parent, value, label) {
    const href = safeHttpsUrl(value);
    if (!href) return;
    const link = node("a", label || href);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    parent.appendChild(link);
  }
  function renderSearch(results) {
    content.replaceChildren(node("h2", "Search results"));
    if (!Array.isArray(results) || results.length === 0) {
      content.appendChild(node("p", "No matching documents.", "empty"));
      return;
    }
    const list = document.createElement("ul");
    for (const result of results.slice(0, 20)) {
      const item = document.createElement("li");
      appendHttpsLink(item, result && result.url, result && result.title ? result.title : "Workspace document");
      if (result && result.id) item.appendChild(node("span", result.id, "meta"));
      list.appendChild(item);
    }
    content.appendChild(list);
  }
  function renderDocument(result) {
    content.replaceChildren(node("h2", result.title || "Workspace document"));
    appendHttpsLink(content, result.url, "Open source");
    if (result.id) content.appendChild(node("div", result.id, "meta"));
    const text = String(result.text || "");
    const preview = text.length > 12000 ? text.slice(0, 12000) + "\n\n[preview truncated in widget]" : text;
    content.appendChild(node("pre", preview || "No document text returned."));
  }
  function render(structuredContent) {
    const value = structuredContent && typeof structuredContent === "object" ? structuredContent : {};
    if (Array.isArray(value.results)) {
      renderSearch(value.results);
      return;
    }
    if (value.id || value.title || value.text) {
      renderDocument(value);
      return;
    }
    content.replaceChildren(node("p", "No renderable Company Knowledge result was returned.", "empty"));
  }
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method === "ui/notifications/tool-result") {
      render(message.params && message.params.structuredContent);
    }
  }, { passive: true });
  if (window.openai && window.openai.toolOutput) render(window.openai.toolOutput);
})();
</script>
</body>
</html>`;
}
