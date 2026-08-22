// @ts-check

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CANONICAL = resolve('src/copilot/infra/platform/process/executable/service.js');
const TERMINAL = resolve('src/copilot/terminal/capabilities/external-tools.js');
const SECURE_TUNNEL = resolve('src/copilot/mcp/openai/secure-tunnel-readiness.js');
const CODE_TOOLS = resolve('src/copilot/tools/code/code-tools.js');
const PUBLIC_ALIAS = '#copilot/infra/public/platform/process/executable';

describe('executable resolver governance', () => {
    it('keeps executable discovery shell-free and ambient-env-free in the canonical process capability', () => {
        const source = readFileSync(CANONICAL, 'utf8');
        expect(source).toContain('export function resolveExecutable');
        expect(source).toContain('constants.X_OK');
        expect(source).not.toContain('node:child_process');
        expect(source).not.toContain('process.env');
        expect(source).not.toMatch(/\b(?:spawn|exec|execFile|execSync|execFileSync)\s*\(/u);
    });

    it('routes the three historical discovery owners through the canonical public micro-surface', () => {
        for (const file of [TERMINAL, SECURE_TUNNEL, CODE_TOOLS]) {
            const source = readFileSync(file, 'utf8');
            expect(source).toContain(PUBLIC_ALIAS);
        }

        const terminal = readFileSync(TERMINAL, 'utf8');
        expect(terminal).not.toContain('function findExecutablePath');
        expect(terminal).not.toContain('constants.X_OK');

        const secureTunnel = readFileSync(SECURE_TUNNEL, 'utf8');
        expect(secureTunnel).not.toContain('function findExecutable');
        expect(secureTunnel).not.toContain('constants.X_OK');

        const codeTools = readFileSync(CODE_TOOLS, 'utf8');
        expect(codeTools).not.toContain('execFileSync');
        expect(codeTools).not.toMatch(/\bwhich\s+eslint\b/u);
        expect(codeTools).not.toMatch(/['"]which['"]/u);
    });
});
