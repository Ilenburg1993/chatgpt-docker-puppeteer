import { getTsserverDaemon, startTsserverDaemon } from '../lsp/tsserver-daemon.mjs';

function formatListResult(title, list, maxPreview = 10) {
    let text = `# ${title}\n\n`;
    text += `Total: ${list.length}\n\n`;
    for (const item of list.slice(0, maxPreview)) {
        text += `- ${JSON.stringify(item)}\n`;
    }
    if (list.length > maxPreview) {
        text += `\n... (${list.length - maxPreview} more)\n`;
    }
    return text;
}

async function withDaemon(operation, params, options = {}) {
    await startTsserverDaemon();
    const daemon = getTsserverDaemon();
    return daemon.execute(operation, params, options);
}

async function lspDefinitionHandler(params, ctx) {
    const locations = await withDaemon('definition', params, ctx);
    return {
        text: formatListResult('LSP Definition', locations),
        json: { operation: 'definition', locations },
        flags: { degraded: false, mutating: false, partial: false },
    };
}

async function lspReferencesHandler(params, ctx) {
    const references = await withDaemon('references', params, ctx);
    return {
        text: formatListResult('LSP References', references),
        json: { operation: 'references', references },
        flags: { degraded: false, mutating: false, partial: false },
    };
}

async function lspHoverHandler(params, ctx) {
    const hover = await withDaemon('hover', params, ctx);
    return {
        text: `# LSP Hover\n\n${hover ? hover.display : 'No hover info available'}`,
        json: { operation: 'hover', hover },
        flags: { degraded: false, mutating: false, partial: false },
    };
}

async function lspDocumentSymbolsHandler(params, ctx) {
    const symbols = await withDaemon('document_symbols', params, ctx);
    return {
        text: formatListResult('LSP Document Symbols', symbols),
        json: { operation: 'document_symbols', symbols },
        flags: { degraded: false, mutating: false, partial: false },
    };
}

async function lspWorkspaceSymbolsHandler(params, ctx) {
    const symbols = await withDaemon('workspace_symbols', params, ctx);
    return {
        text: formatListResult('LSP Workspace Symbols', symbols),
        json: { operation: 'workspace_symbols', symbols },
        flags: { degraded: false, mutating: false, partial: false },
    };
}

async function lspDiagnosticsHandler(params, ctx) {
    const diagnostics = await withDaemon('diagnostics', params, ctx);
    return {
        text: formatListResult('LSP Diagnostics', diagnostics),
        json: { operation: 'diagnostics', diagnostics },
        flags: { degraded: false, mutating: false, partial: false },
    };
}

async function lspCodeActionsHandler(params, ctx) {
    const actions = await withDaemon('code_actions', params, ctx);
    return {
        text: formatListResult('LSP Code Actions', actions),
        json: { operation: 'code_actions', actions },
        flags: { degraded: false, mutating: false, partial: false },
    };
}

async function lspApplyCodeActionHandler(params, ctx) {
    const result = await withDaemon('apply_code_action', params, ctx);
    const previewMode = String(params.mode || 'preview') === 'preview';
    return {
        text: `# LSP Apply Code Action\n\nMode: ${result.mode}\nFiles: ${result.files.length}\nEdits: ${result.totalEdits}`,
        json: { operation: 'apply_code_action', ...result },
        flags: { degraded: false, mutating: !previewMode, partial: false },
    };
}

/** Função exportada: registerLspTools. */
export async function registerLspTools(registry) {
    registry.register(
        'lsp_definition',
        {
            description: 'Find definition for symbol in JS/TS file',
            inputSchema: {
                type: 'object',
                properties: {
                    filePath: { type: 'string' },
                    line: { type: 'number' },
                    character: { type: 'number' },
                },
                required: ['filePath', 'line', 'character'],
            },
        },
        lspDefinitionHandler
    );

    registry.register(
        'lsp_references',
        {
            description: 'Find references for symbol in JS/TS file',
            inputSchema: {
                type: 'object',
                properties: {
                    filePath: { type: 'string' },
                    line: { type: 'number' },
                    character: { type: 'number' },
                },
                required: ['filePath', 'line', 'character'],
            },
        },
        lspReferencesHandler
    );

    registry.register(
        'lsp_hover',
        {
            description: 'Get hover/type information for symbol in JS/TS file',
            inputSchema: {
                type: 'object',
                properties: {
                    filePath: { type: 'string' },
                    line: { type: 'number' },
                    character: { type: 'number' },
                },
                required: ['filePath', 'line', 'character'],
            },
        },
        lspHoverHandler
    );

    registry.register(
        'lsp_document_symbols',
        {
            description: 'List document symbols in a JS/TS file',
            inputSchema: {
                type: 'object',
                properties: {
                    filePath: { type: 'string' },
                },
                required: ['filePath'],
            },
        },
        lspDocumentSymbolsHandler
    );

    registry.register(
        'lsp_workspace_symbols',
        {
            description: 'Search workspace symbols by query',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    maxResults: { type: 'number' },
                },
                required: ['query'],
            },
        },
        lspWorkspaceSymbolsHandler
    );

    registry.register(
        'lsp_diagnostics',
        {
            description: 'Collect diagnostics for a JS/TS file',
            inputSchema: {
                type: 'object',
                properties: {
                    filePath: { type: 'string' },
                },
                required: ['filePath'],
            },
        },
        lspDiagnosticsHandler
    );

    registry.register(
        'lsp_code_actions',
        {
            description: 'List available code actions in a range',
            inputSchema: {
                type: 'object',
                properties: {
                    filePath: { type: 'string' },
                    line: { type: 'number' },
                    character: { type: 'number' },
                    endLine: { type: 'number' },
                    endCharacter: { type: 'number' },
                    maxResults: { type: 'number' },
                },
                required: ['filePath', 'line', 'character'],
            },
        },
        lspCodeActionsHandler
    );

    registry.register(
        'lsp_apply_code_action',
        {
            description: 'Preview/apply a selected LSP code action',
            allowMutations: true,
            requiresConfirmationToken: true,
            inputSchema: {
                type: 'object',
                properties: {
                    mode: { type: 'string', enum: ['preview', 'apply'], default: 'preview' },
                    action: { type: 'object' },
                    confirmationToken: { type: 'string' },
                },
                required: ['mode', 'action'],
            },
        },
        lspApplyCodeActionHandler
    );
}
