// @ts-check

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FOUNDATION = resolve('src/copilot/infra/platform/node/compile-cache.js');
const PROCESS_INFRA = resolve('src/copilot/infra/composition/process/service.js');
const PROCESS_HEALTH = resolve('src/copilot/infra/observability/process/service.js');
const PUBLIC = resolve('src/copilot/infra/public/platform/node/index.js');
const MCP_CLI = resolve('src/copilot/mcp/cli.js');
const SAFE_SUITE = resolve('src/copilot/mcp/scripts/run-safe-validation-suite.js');
const OLD_MCP_FACADE = resolve('src/copilot/mcp/runtime/node-compile-cache.js');

describe('Node compile-cache process ownership governance', () => {
    it('keeps configuration explicit and adopts early bootstrap through ProcessInfra', () => {
        const foundation = readFileSync(FOUNDATION, 'utf8');
        const processInfra = readFileSync(PROCESS_INFRA, 'utf8');
        const executableFoundation = foundation
            .split(/\r?\n/u)
            .filter((line) => {
                const trimmed = line.trim();
                return (
                    !trimmed.startsWith('*') &&
                    !trimmed.startsWith('/**') &&
                    trimmed !== '*/' &&
                    !trimmed.startsWith('//')
                );
            })
            .join('\n');
        expect(executableFoundation).not.toContain('process.env');
        expect(foundation).toContain('activateCopilotNodeCompileCacheProcessOwner');
        expect(foundation).toContain('ERR_NODE_COMPILE_CACHE_CONFIG_MISMATCH');
        expect(foundation).toContain("'adopted-early'");
        expect(foundation).toContain("'not-activated'");
        expect(processInfra).toContain('activateCopilotNodeCompileCacheProcessOwner');
        expect(processInfra).toContain('config: config.compileCache');
    });

    it('keeps ownership internal while exposing only operational compile-cache functions publicly', () => {
        const publicSource = readFileSync(PUBLIC, 'utf8');
        expect(publicSource).toContain('enableCopilotNodeCompileCache');
        expect(publicSource).toContain('readCopilotNodeCompileCacheConfig');
        expect(publicSource).not.toContain('activateCopilotNodeCompileCacheProcessOwner');
    });

    it('projects compile-cache through process health instead of a separate MCP-global health read', () => {
        const processHealth = readFileSync(PROCESS_HEALTH, 'utf8');
        expect(processHealth).toContain('getCopilotNodeCompileCacheHealth');
        expect(processHealth).toContain('facetOwnership.compileCache');
        expect(processHealth).toContain('ownerProcessId: processId');
    });

    it('removes the MCP compatibility facade and makes launchers consume the Infra micro-surface directly', () => {
        expect(existsSync(OLD_MCP_FACADE)).toBe(false);
        const cli = readFileSync(MCP_CLI, 'utf8');
        const safeSuite = readFileSync(SAFE_SUITE, 'utf8');
        expect(cli).toContain("from '#copilot/infra/public/platform/node'");
        expect(safeSuite).toContain("from '#copilot/infra/public/platform/node'");
        expect(safeSuite).not.toContain('../runtime/node-compile-cache.js');
    });
});
