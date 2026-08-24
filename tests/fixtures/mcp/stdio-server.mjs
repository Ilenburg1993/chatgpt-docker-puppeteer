// @ts-check
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const server = /** @type {any} */ (new McpServer({ name: 'fixture-stdio-mcp', version: '0.0.0' }));

server.registerTool(
    'echo',
    { description: 'Echo back the provided message', inputSchema: z.object({ message: z.string() }) },
    async (/** @type {{ message: string }} */ { message }) => {
        return { content: [{ type: 'text', text: message }] };
    },
);

server.registerTool(
    'add',
    { description: 'Add two numbers', inputSchema: z.object({ a: z.number(), b: z.number() }) },
    async (/** @type {{ a: number; b: number }} */ { a, b }) => {
        return { content: [{ type: 'text', text: String(a + b) }] };
    },
);

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
