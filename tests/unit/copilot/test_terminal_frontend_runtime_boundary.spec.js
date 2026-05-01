// @ts-check

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const SRC = readFileSync(
    '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/frontend/llm-b-frontend.js',
    'utf8',
);

const SRC_NOW = readFileSync(
    '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/frontend/projections/now.js',
    'utf8',
);

test('llm-b-frontend é shim puro: re-exporta apenas de ./projections/', () => {
    // Shim só deve ter re-exports de projections/ ou sdk-session-projection
    expect(SRC).toMatch(/from '\.\/projections\//);
    // Não deve conter nenhuma implementação direta (função export function)
    expect(SRC).not.toMatch(/^export\s+(async\s+)?function\s+/m);
    // Não deve importar de agentes/canais/hubs/core diretamente
    expect(SRC).not.toMatch(/from '#copilot\/agent'/);
    expect(SRC).not.toMatch(/from '#copilot\/channel'/);
    expect(SRC).not.toMatch(/from '#copilot\/conversation-hub'/);
    expect(SRC).not.toMatch(/from '#copilot\/core'/);
});

test('projections/now.js usa gateway llm-b-runtime em vez de agent/channel/hub/core diretos', () => {
    expect(SRC_NOW).toMatch(/from '\.\.\/llm-b-runtime\.js'/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/agent'/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/channel'/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/conversation-hub'/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/core'/);
});
