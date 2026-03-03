// @ts-check
/**
 * Optional: Import tools from an upstream MCP server (HTTP JSON-RPC) and register
 * them into the local Tool Registry with a namespace/prefix.
 *
 * ENV:
 * - MCP_UPSTREAM_ENABLED=true
 * - MCP_UPSTREAM_URL=http://localhost:3008/api/mcp
 * - MCP_UPSTREAM_ALIAS=core (optional; default: upstream)
 * - MCP_UPSTREAM_TOOL_PREFIX=mcp_core__ (optional; default derived from alias)
 * - MCP_UPSTREAM_HEADERS_JSON={"Authorization":"Bearer ..."} (optional)
 */

import { createMcpHttpClient } from '../mcp/upstream-http.mjs';

function parseJsonObject(value) {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function sanitizeToolMetadata(tool) {
    const description =
        typeof tool?.description === 'string' && tool.description.trim()
            ? tool.description
            : '(no description provided by upstream)';

    const inputSchema =
        tool?.inputSchema && typeof tool.inputSchema === 'object'
            ? tool.inputSchema
            : { type: 'object', properties: {} };

    return { description, inputSchema };
}

/**
 * Função exportada: registerUpstreamMcpTools.
 * @returns {Promise<void>}
 */
export async function registerUpstreamMcpTools(registry, options = {}) {
    const enabled = options.enabled ?? process.env.MCP_UPSTREAM_ENABLED === 'true';
    if (!enabled) {
        return { enabled: false, registered: 0 };
    }

    const url = options.url ?? process.env.MCP_UPSTREAM_URL;
    if (!url) {
        throw new Error('MCP_UPSTREAM_ENABLED=true but MCP_UPSTREAM_URL is missing');
    }

    const alias = options.alias ?? process.env.MCP_UPSTREAM_ALIAS ?? 'upstream';
    const prefix = options.prefix ?? process.env.MCP_UPSTREAM_TOOL_PREFIX ?? `mcp_${alias}__`;

    const headers = options.headers ?? parseJsonObject(process.env.MCP_UPSTREAM_HEADERS_JSON) ?? undefined;

    const client = createMcpHttpClient({ url, headers });

    const toolList = await client.listTools();
    const tools = Array.isArray(toolList?.tools) ? toolList.tools : [];

    let registered = 0;
    for (const tool of tools) {
        if (!tool?.name || typeof tool.name !== 'string') {
            continue;
        }

        const upstreamName = tool.name;
        const localName = `${prefix}${upstreamName}`;

        const { description, inputSchema } = sanitizeToolMetadata(tool);

        registry.register(
            localName,
            {
                description: `[Upstream:${alias}] ${description}`,
                inputSchema,
            },
            async (params = {}, execOptions = {}) => {
                const result = await client.callTool({
                    name: upstreamName,
                    arguments: params,
                    signal: execOptions.signal,
                });

                // Pass through MCP tool result shape when available.
                // MCP handler will preserve it (instead of re-wrapping into text).
                return result;
            }
        );

        registered += 1;
    }

    console.error(`[MCP Upstream] Registered ${registered} tools from ${url} as prefix "${prefix}"`);
    return { enabled: true, registered, alias, prefix, url };
}
