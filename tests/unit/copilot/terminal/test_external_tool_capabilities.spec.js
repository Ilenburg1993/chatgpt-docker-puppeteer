// @ts-check

import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import {
    clearTerminalExternalToolCapabilityCache,
    readTerminalExternalToolCapabilities,
    readTerminalExternalToolCapabilitySummary,
} from '../../../../src/copilot/terminal/capabilities/index.js';

function makeExecutableFixture(command, body = '#!/bin/sh\nprintf "%s\\n" "$0 1.2.3"\n') {
    const dir = join(tmpdir(), `terminal-tool-${command}-${process.pid}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, command);
    writeFileSync(file, body, { mode: 0o755 });
    return { dir, file };
}

describe('terminal/capabilities/external-tools', () => {
    it('detecta binário disponível usando PATH informado sem depender da máquina real', () => {
        const fixture = makeExecutableFixture('fzf', '#!/bin/sh\nprintf "fzf 0.66.0\\n"\n');

        const tools = readTerminalExternalToolCapabilities({ env: { PATH: fixture.dir } });
        const fzf = tools.find((tool) => tool.id === 'fzf');
        const bat = tools.find((tool) => tool.id === 'bat');

        expect(fzf).toMatchObject({
            id: 'fzf',
            available: true,
            command: 'fzf',
            path: fixture.file,
            version: 'fzf 0.66.0',
            decision: 'accepted',
            defaultEnabled: false,
        });
        expect(bat).toMatchObject({ id: 'bat', available: false, command: null, path: null });
    });

    it('prefere batcat quando bat não existe e preserva decisão/fallback', () => {
        const fixture = makeExecutableFixture('batcat', '#!/bin/sh\nprintf "bat 0.25.0\\n"\n');

        const summary = readTerminalExternalToolCapabilitySummary({ env: { PATH: fixture.dir } });
        const bat = summary.tools.find((tool) => tool.id === 'bat');

        expect(summary.available).toBe(1);
        expect(summary.acceptedAvailable).toBe(1);
        expect(bat?.command).toBe('batcat');
        expect(bat?.version).toBe('bat 0.25.0');
        expect(bat?.fallback).toContain('preview textual JS');
    });

    it('mantém atuin e zoxide como detectáveis, mas adiados e desabilitados por default', () => {
        const atuin = makeExecutableFixture('atuin', '#!/bin/sh\nprintf "atuin 18.6.1\\n"\n');
        const zoxide = makeExecutableFixture('zoxide', '#!/bin/sh\nprintf "zoxide 0.9.8\\n"\n');

        const summary = readTerminalExternalToolCapabilitySummary({
            env: { PATH: [atuin.dir, zoxide.dir].join(delimiter) },
        });

        expect(summary.deferredAvailable).toBe(2);
        for (const id of ['atuin', 'zoxide']) {
            const tool = summary.tools.find((candidate) => candidate.id === id);
            expect(tool?.available).toBe(true);
            expect(tool?.decision).toBe('deferred');
            expect(tool?.defaultEnabled).toBe(false);
        }
    });

    it('limpa cache global sem afetar chamadas com env explícito', () => {
        clearTerminalExternalToolCapabilityCache();
        const tools = readTerminalExternalToolCapabilities({ env: { PATH: '' } });
        expect(tools.every((tool) => tool.available === false)).toBe(true);
        clearTerminalExternalToolCapabilityCache();
    });
});
