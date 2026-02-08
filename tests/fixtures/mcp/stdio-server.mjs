// @ts-check
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'fixture-stdio-mcp', version: '0.0.0' });

server.tool('echo', 'Echo back the provided message', { message: z.string() }, async ({ message }) => {
    return { content: [{ type: 'text', text: message }] };
});

server.tool('add', 'Add two numbers', { a: z.number(), b: z.number() }, async ({ a, b }) => {
    return { content: [{ type: 'text', text: String(a + b) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);

async function shutdown() {
    try {
        await server.close();
    } catch {
        // ignore
    }
    try {
        await transport.close();
    } catch {
        // ignore
    }
}

process.on('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().finally(() => process.exit(0)));

