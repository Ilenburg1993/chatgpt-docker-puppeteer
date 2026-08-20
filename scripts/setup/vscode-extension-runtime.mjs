// @ts-check

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** @returns {string[]} */
export function readInstalledExtensions() {
    try {
        return execFileSync('code', ['--list-extensions'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
            .split(/\r?\n/u)
            .map((value) => value.trim())
            .filter(Boolean);
    } catch (error) {
        throw new Error(`VS Code CLI indisponível: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
}

/**
 * Lê os manifests entregues junto ao servidor VS Code. `code --list-extensions` omite builtins, embora eles satisfaçam
 * capacidades core como o Copilot unificado nas versões atuais.
 *
 * @param {{ rootDir?: string }} [options]
 * @returns {string[]}
 */
export function readBuiltInExtensions({ rootDir = process.env['VSCODE_CWD'] ?? '' } = {}) {
    const extensionsDir = path.join(rootDir, 'extensions');
    if (!rootDir || !fs.existsSync(extensionsDir)) return [];
    const identifiers = [];
    for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(extensionsDir, entry.name, 'package.json'), 'utf8'));
            if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) continue;
            const record = /** @type {Record<string, unknown>} */ (manifest);
            if (typeof record['publisher'] !== 'string' || typeof record['name'] !== 'string') continue;
            identifiers.push(`${record['publisher']}.${record['name']}`);
        } catch {
            // Um diretório builtin sem manifest legível não pode satisfazer um requisito do catálogo.
        }
    }
    return identifiers;
}

/** @param {readonly string[]} installed @param {readonly string[]} builtIn */
export function availableExtensions(installed, builtIn) {
    return [...new Set([...installed, ...builtIn].map((extension) => extension.toLowerCase()))];
}
