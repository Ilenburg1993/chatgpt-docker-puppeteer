// @ts-check

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const SRC = readFileSync('/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/frontend/index.js', 'utf8');

const SRC_NOW = readFileSync(
    '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/frontend/projections/now.js',
    'utf8',
);

test('frontend/index.js reexporta apenas famílias canônicas do frontend', () => {
    // Barrel deve apontar apenas para projections/, gateways/ e sdk-session-projection
    expect(SRC).toMatch(/from '\.\/projections\//);
    expect(SRC).toMatch(/from '\.\/gateways\//);
    // Não deve conter nenhuma implementação direta (função export function)
    expect(SRC).not.toMatch(/^export\s+(async\s+)?function\s+/m);
    // Não deve importar de agentes/canais/hubs/core diretamente
    expect(SRC).not.toMatch(/from '#copilot\/agent'/);
    expect(SRC).not.toMatch(/from '#copilot\/channel'/);
    expect(SRC).not.toMatch(/from '#copilot\/conversation-hub'/);
    expect(SRC).not.toMatch(/from '#copilot\/core'/);
});

test('projections/now.js usa gateways especializados em vez de shim agregado', () => {
    expect(SRC_NOW).toMatch(/from '\.\.\/gateways\/agent-runtime\.js'/);
    expect(SRC_NOW).toMatch(/from '\.\.\/gateways\/dialog\.js'/);
    expect(SRC_NOW).toMatch(/from '\.\.\/gateways\/hub\.js'/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/agent'/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/channel'/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/conversation-hub'/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/core'/);
});
