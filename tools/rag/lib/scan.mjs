import { promises as fs } from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';
import { isProbablyBinary } from './text.mjs';

const ALLOW_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.yml', '.yaml', '.sh', '.ps1']);
const ALWAYS_ALLOW_BASENAMES = new Set(['Dockerfile', 'Makefile']);
const ALWAYS_DENY_BASENAMES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);

const DENY_DIR_PREFIXES = [
    'node_modules/',
    '.git/',
    'logs/',
    'fila/',
    'respostas/',
    'coverage/',
    '.vscode-server/',
    '.devcontainer/state/',
    'analysis/' // Exclude heavy analysis docs (1.1MB+) to reduce indexing load
];

function isAllowedByExt(relPath) {
    const base = path.posix.basename(relPath);
    if (ALWAYS_ALLOW_BASENAMES.has(base)) return true;
    if (base.toLowerCase().endsWith('.dockerfile')) return true;
    if (base.endsWith('.env.example')) return true;
    const ext = path.posix.extname(base).toLowerCase();
    return ALLOW_EXT.has(ext);
}

function isDenied(relPath) {
    const p = relPath.endsWith('/') ? relPath : `${relPath}`;
    const base = path.posix.basename(relPath);
    if (ALWAYS_DENY_BASENAMES.has(base)) return true;
    if (base === '.env') return true;
    if (base.endsWith('.env.example')) return false;
    if (base.startsWith('.env.')) return true;

    // CRITICAL: Deny node_modules ANYWHERE in path (not just root)
    // Fixes: dashboard-ui/node_modules/, tests/fixtures/node_modules/, etc.
    if (p.includes('/node_modules/') || p.startsWith('node_modules/')) {
        return true;
    }

    for (const pref of DENY_DIR_PREFIXES) {
        if (p.startsWith(pref)) return true;
    }
    return false;
}

export async function findProjectRoot(startDir = process.cwd()) {
    let current = path.resolve(startDir);
    while (true) {
        const candidate = path.join(current, 'package.json');
        try {
            await fs.access(candidate);
            return current;
        } catch (_) {
            const parent = path.dirname(current);
            if (parent === current) return startDir;
            current = parent;
        }
    }
}

export async function scanWorkspace(rootDir, { maxFileBytes = 2_000_000 } = {}) {
    const root = path.resolve(rootDir);
    const ig = ignore();
    try {
        const raw = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
        ig.add(raw);
    } catch (_) {
        // no .gitignore
    }

    const results = [];

    async function walk(relDir) {
        const fullDir = path.join(root, relDir);
        let entries;
        try {
            entries = await fs.readdir(fullDir, { withFileTypes: true });
        } catch (_) {
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const ent of entries) {
            const relPath = relDir ? path.posix.join(relDir, ent.name) : ent.name;
            const relPathPosix = relPath.split(path.sep).join('/');

            if (isDenied(relPathPosix) || ig.ignores(relPathPosix)) continue;

            if (ent.isSymbolicLink()) continue;

            if (ent.isDirectory()) {
                await walk(relPathPosix);
                continue;
            }

            if (!ent.isFile()) continue;
            if (!isAllowedByExt(relPathPosix)) continue;

            const fullPath = path.join(root, relPathPosix);
            let stat;
            try {
                stat = await fs.stat(fullPath);
            } catch (_) {
                continue;
            }
            if (stat.size > maxFileBytes) continue;

            try {
                const buf = await fs.readFile(fullPath);
                if (isProbablyBinary(buf)) continue;
                results.push({
                    relPath: relPathPosix,
                    fullPath,
                    size: stat.size,
                    mtimeMs: stat.mtimeMs,
                    buffer: buf
                });
            } catch (_) {
                continue;
            }
        }
    }

    await walk('');
    results.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return results;
}
