// @ts-check
/** Read-only Company Knowledge MCP wire adapters. */

import {
    MAX_QUERY_LENGTH,
    buildCompanyKnowledgeDocumentMetadata,
    fetchCompanyKnowledgeDocument,
    searchCompanyKnowledge,
} from '#copilot/mcp/public/company-knowledge';
import { COMPANY_KNOWLEDGE_WIDGET_URI } from '#copilot/mcp/public/protocol/apps-sdk';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    okResult,
    requireMcpToolCompanyKnowledgeConfig,
    requireMcpToolWorkspace,
} from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

export const COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME = 'search';
export const COMPANY_KNOWLEDGE_FETCH_TOOL_NAME = 'fetch';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]}
 */
export const companyKnowledgeTools = [
    defineMcpRawTool({
        name: COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME,
        title: 'Search Company Knowledge',
        description:
            'Search the bounded local Company Knowledge corpus. Read-only; returns only id, title and url for fetchable workspace documents.',
        inputSchema: {
            query: z.string().min(1).max(MAX_QUERY_LENGTH)['describe']('Search query string.'),
        },
        outputSchema: {
            results: z.array(
                z.object({
                    id: z.string(),
                    title: z.string(),
                    url: z.string(),
                }),
            ),
        },

        _meta: {
            ui: { resourceUri: COMPANY_KNOWLEDGE_WIDGET_URI },
            'openai/outputTemplate': COMPANY_KNOWLEDGE_WIDGET_URI,
            'openai/toolInvocation/invoking': 'Buscando conhecimento...',
            'openai/toolInvocation/invoked': 'Busca concluida',
        },
        handler: async ({ query }, operationContext) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            const config = requireMcpToolCompanyKnowledgeConfig(operationContext);
            const results = await searchCompanyKnowledge(workspace, String(query ?? ''), config);
            const structured = { results };
            return okResult(structured, JSON.stringify(structured));
        },
    }),
    defineMcpRawTool({
        name: COMPANY_KNOWLEDGE_FETCH_TOOL_NAME,
        title: 'Fetch Company Knowledge',
        description:
            'Fetch one document previously returned by Company Knowledge search. Read-only; the id must be a repo:* result id.',
        inputSchema: {
            id: z.string().min(1).max(4096)['describe']('Document id returned by the search tool.'),
        },
        outputSchema: {
            id: z.string(),
            title: z.string(),
            text: z.string(),
            url: z.string(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        },

        _meta: {
            ui: { resourceUri: COMPANY_KNOWLEDGE_WIDGET_URI },
            'openai/outputTemplate': COMPANY_KNOWLEDGE_WIDGET_URI,
            'openai/toolInvocation/invoking': 'Lendo conhecimento...',
            'openai/toolInvocation/invoked': 'Leitura concluida',
        },
        handler: async ({ id }, operationContext) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            const config = requireMcpToolCompanyKnowledgeConfig(operationContext);
            const document = await fetchCompanyKnowledgeDocument(workspace, String(id ?? ''), config);
            if (!document) {
                return errorResult('Company Knowledge document not found.', {
                    code: 'COMPANY_KNOWLEDGE_DOCUMENT_NOT_FOUND',
                    hint: 'Call search first and pass an id returned by that tool.',
                });
            }
            const structured = {
                id: document.id,
                title: document.title,
                text: document.text,
                url: document.url,
                metadata: buildCompanyKnowledgeDocumentMetadata(document),
            };
            return okResult(structured, JSON.stringify(structured));
        },
    }),
];
