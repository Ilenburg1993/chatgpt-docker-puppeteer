#!/usr/bin/env node
// @ts-check
/**
 * scripts/event-flow-graph.mjs — FAIXA-L17
 *
 * Gera diagramas Mermaid automaticamente a partir do código, mostrando o fluxo de eventos entre módulos.
 *
 * Analisa:
 *
 * - emit() calls → produtores
 * - on()/once() calls → consumidores
 * - bridgeEmitter map → ponte agent→EventBus
 * - bus.on() → subscribers do EventBus
 *
 * Uso: node scripts/event-flow-graph.mjs [--output FILE] [--json]
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src', 'copilot');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const outputIdx = args.indexOf('--output');
const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : null;

/**
 * @typedef {{ module: string; event: string; line: number }} EmitSite
 *
 * @typedef {{ module: string; event: string; line: number }} ListenerSite
 */

/**
 * Percorre recursivamente arquivos .js em um diretório.
 *
 * @param {string} dir
 * @param {string[]} [results]
 * @returns {Promise<string[]>}
 */
async function walkJS(dir, results = []) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') continue;
            await walkJS(full, results);
        } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.spec.js')) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Extrai o nome do módulo a partir do caminho relativo.
 *
 * @param {string} filePath
 * @returns {string}
 */
function moduleName(filePath) {
    const rel = path.relative(SRC_DIR, filePath);
    const parts = rel.split(path.sep);
    // Use the first directory as the module group
    return parts.length > 1 ? parts[0] : 'root';
}

const EMIT_RE = /\.emit\(\s*(?:['"]([^'"]+)['"]|\{\s*type:\s*['"]([^'"]+)['"])/g;
const ON_RE = /\.(?:on|once|addListener)\(\s*['"]([^'"]+)['"]/g;

/**
 * @param {string} filePath
 * @returns {Promise<{ emits: EmitSite[]; listeners: ListenerSite[] }>}
 */
async function scanFile(filePath) {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const mod = moduleName(filePath);
    /** @type {EmitSite[]} */
    const emits = [];
    /** @type {ListenerSite[]} */
    const listeners = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ')) continue;

        EMIT_RE.lastIndex = 0;
        let m;
        while ((m = EMIT_RE.exec(line)) !== null) {
            const evt = m[1] ?? m[2] ?? '';
            if (evt && evt !== '*') emits.push({ module: mod, event: evt, line: i + 1 });
        }

        ON_RE.lastIndex = 0;
        while ((m = ON_RE.exec(line)) !== null) {
            const evt = m[1] ?? '';
            if (evt && evt !== '*' && evt !== 'error') listeners.push({ module: mod, event: evt, line: i + 1 });
        }
    }

    return { emits, listeners };
}

/**
 * @param {{ emits: EmitSite[]; listeners: ListenerSite[] }} data
 * @returns {string}
 */
function generateMermaid({ emits, listeners }) {
    /** @type {Map<string, Set<string>>} */
    const moduleEmits = new Map();
    /** @type {Map<string, Set<string>>} */
    const moduleListens = new Map();

    for (const e of emits) {
        if (!moduleEmits.has(e.module)) moduleEmits.set(e.module, new Set());
        /** @type {Set<string>} */ (moduleEmits.get(e.module)).add(e.event);
    }

    for (const l of listeners) {
        if (!moduleListens.has(l.module)) moduleListens.set(l.module, new Set());
        /** @type {Set<string>} */ (moduleListens.get(l.module)).add(l.event);
    }

    // Build edges: producer module → consumer module via shared events
    /** @type {Map<string, number>} */
    const edges = new Map();

    for (const [prodMod, prodEvents] of moduleEmits) {
        for (const [consMod, consEvents] of moduleListens) {
            if (prodMod === consMod) continue;
            let shared = 0;
            for (const evt of prodEvents) {
                if (consEvents.has(evt)) shared++;
            }
            if (shared > 0) {
                const key = `${prodMod}|${consMod}`;
                edges.set(key, (edges.get(key) ?? 0) + shared);
            }
        }
    }

    // Count unique events per module
    const allModules = new Set([...moduleEmits.keys(), ...moduleListens.keys()]);

    const lines = ['graph TD'];

    // Node declarations
    for (const mod of allModules) {
        const emitCount = moduleEmits.get(mod)?.size ?? 0;
        const listenCount = moduleListens.get(mod)?.size ?? 0;
        const sanitized = mod.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`    ${sanitized}[${mod}<br/>emit:${emitCount} listen:${listenCount}]`);
    }

    // Edge declarations
    for (const [key, count] of edges) {
        const [from, to] = key.split('|');
        if (!from || !to) continue;
        const fromSan = from.replace(/[^a-zA-Z0-9_]/g, '_');
        const toSan = to.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`    ${fromSan} -->|${count} events| ${toSan}`);
    }

    return lines.join('\n');
}

async function main() {
    const files = await walkJS(SRC_DIR);
    /** @type {EmitSite[]} */
    const allEmits = [];
    /** @type {ListenerSite[]} */
    const allListeners = [];

    for (const file of files) {
        const { emits, listeners } = await scanFile(file);
        allEmits.push(...emits);
        allListeners.push(...listeners);
    }

    const data = { emits: allEmits, listeners: allListeners };

    if (jsonMode) {
        const summary = {
            totalEmits: allEmits.length,
            totalListeners: allListeners.length,
            uniqueEmitEvents: [...new Set(allEmits.map((e) => e.event))].length,
            uniqueListenEvents: [...new Set(allListeners.map((l) => l.event))].length,
            modules: [...new Set([...allEmits.map((e) => e.module), ...allListeners.map((l) => l.module)])],
        };
        console.log(JSON.stringify(summary, null, 2));
    } else {
        const mermaid = generateMermaid(data);
        const md = `# Event Flow Graph\n\n> Auto-gerado por \`scripts/event-flow-graph.mjs\` (FAIXA-L17)\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n## Estatísticas\n\n- **Emits encontrados**: ${allEmits.length}\n- **Listeners encontrados**: ${allListeners.length}\n- **Eventos únicos (emit)**: ${[...new Set(allEmits.map((e) => e.event))].length}\n- **Eventos únicos (listen)**: ${[...new Set(allListeners.map((l) => l.event))].length}\n`;

        if (outputFile) {
            await writeFile(path.resolve(outputFile), md, 'utf-8');
            console.log(`✅ Grafo salvo em ${outputFile}`);
        } else {
            console.log(md);
        }
    }
}

main().catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(2);
});
