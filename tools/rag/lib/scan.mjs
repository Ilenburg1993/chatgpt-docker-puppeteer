import { promises as fs } from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';
import { isProbablyBinary } from './text.mjs';

// Allow .md files (tests and many projects rely on README/docs scanning)
// Can be re-enabled later with: analysis/ excluded + selective indexing
const ALLOW_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.yml', '.yaml', '.sh', '.ps1', '.md', '.mdx']);
const ALWAYS_ALLOW_BASENAMES = new Set(['Dockerfile', 'Makefile']);
const ALWAYS_DENY_BASENAMES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const DOC_EXTENSIONS = new Set(['.md', '.mdx']);

const DENY_DIR_PREFIXES = [
    'node_modules/',
    '.git/',
    'logs/',
    'fila/',
    'respostas/',
    'coverage/',
    '.vscode-server/',
    '.devcontainer/state/',
    'analysis/', // Exclude heavy analysis docs (1.1MB+) to reduce indexing load
];

export const RAG_SCAN_PROFILES = {
    core: [
        'src/**',
        'tests/**',
        'package.json',
        'config*.json',
        '*.config.js',
        '*.config.cjs',
        '*.config.mjs',
        'jsconfig.json',
        'tsconfig.json',
    ],
    dev: [
        'src/**',
        'tests/**',
        'scripts/**',
        'tools/rag/**',
        'README.md',
        'package.json',
        'config*.json',
        '*.config.js',
        '*.config.cjs',
        '*.config.mjs',
        'jsconfig.json',
        'tsconfig.json',
    ],
    full: [],
};

function isAllowedByExt(relPath) {
    const base = path.posix.basename(relPath);
    if (ALWAYS_ALLOW_BASENAMES.has(base)) return true;
    if (base.toLowerCase().endsWith('.dockerfile')) return true;
    if (base.endsWith('.env.example')) return true;
    const ext = path.posix.extname(base).toLowerCase();
    return ALLOW_EXT.has(ext);
}

function resolveDocsMode(rawMode) {
    const normalized = String(rawMode || '')
        .trim()
        .toLowerCase();
    if (normalized === 'exclude' || normalized === 'only') return normalized;
    return 'include';
}

function isDocLikePath(relPath) {
    const ext = path.posix.extname(String(relPath || '')).toLowerCase();
    return DOC_EXTENSIONS.has(ext);
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

function globToRegExp(pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '::DOUBLE_STAR::')
        .replace(/\*/g, '[^/]*')
        .replace(/::DOUBLE_STAR::/g, '.*')
        .replace(/\?/g, '[^/]');
    return new RegExp(`^${escaped}$`);
}

function compileGlobs(globs = []) {
    return globs
        .map(g => String(g || '').trim())
        .filter(Boolean)
        .map(g => ({ raw: g, re: globToRegExp(g) }));
}

function matchesAny(relPath, compiledGlobs) {
    if (!compiledGlobs || compiledGlobs.length === 0) return false;
    return compiledGlobs.some(({ re }) => re.test(relPath));
}

function normalizeRelPathInput(relPath) {
    return String(relPath || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.?\//, '');
}

function buildCompiledGlobs({ profile = 'full', includeGlobs = [], excludeGlobs = [] } = {}) {
    const profileName = String(profile || 'full');
    const profileGlobs = RAG_SCAN_PROFILES[profileName] ?? RAG_SCAN_PROFILES.full;
    const compiledInclude = compileGlobs([...profileGlobs, ...(includeGlobs || [])]);
    const compiledExclude = compileGlobs(excludeGlobs || []);
    return {
        compiledInclude,
        compiledExclude,
        shouldFilterByInclude: compiledInclude.length > 0,
    };
}

export function isRagIndexableRelPath(relPath, options = {}) {
    const normalized = normalizeRelPathInput(relPath);
    if (!normalized) return false;
    if (isDenied(normalized)) return false;
    if (!isAllowedByExt(normalized)) return false;
    const docsMode = resolveDocsMode(options.docsMode ?? process.env.RAG_DOCS_MODE ?? 'include');
    if (docsMode === 'exclude' && isDocLikePath(normalized)) return false;
    if (docsMode === 'only' && !isDocLikePath(normalized)) return false;

    const { compiledInclude, compiledExclude, shouldFilterByInclude } = buildCompiledGlobs(options);
    if (matchesAny(normalized, compiledExclude)) return false;
    if (shouldFilterByInclude && !matchesAny(normalized, compiledInclude)) return false;

    return true;
}

export async function loadWorkspaceFile(rootDir, relPath, options = {}) {
    const normalized = normalizeRelPathInput(relPath);
    if (!normalized) return null;
    if (!isRagIndexableRelPath(normalized, options)) return null;

    const root = path.resolve(rootDir);
    const fullPath = path.join(root, normalized);
    let stat;
    try {
        stat = await fs.stat(fullPath);
    } catch {
        return null;
    }
    if (!stat.isFile()) return null;

    const maxFileBytes = Number(options.maxFileBytes || 2_000_000);
    if (stat.size > maxFileBytes) return null;

    try {
        const buffer = await fs.readFile(fullPath);
        if (isProbablyBinary(buffer)) return null;
        return {
            relPath: normalized,
            fullPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            buffer,
        };
    } catch {
        return null;
    }
}

export async function scanWorkspace(
    rootDir,
    {
        profile = 'full',
        includeGlobs = [],
        excludeGlobs = [],
        maxFileBytes = 2_000_000,
        docsMode = process.env.RAG_DOCS_MODE || 'include',
    } = {}
) {
    const root = path.resolve(rootDir);
    const ig = ignore();
    try {
        const raw = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
        ig.add(raw);
    } catch (_) {
        // no .gitignore
    }

    const { compiledInclude, compiledExclude, shouldFilterByInclude } = buildCompiledGlobs({
        profile,
        includeGlobs,
        excludeGlobs,
    });
    const resolvedDocsMode = resolveDocsMode(docsMode);

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
            if (resolvedDocsMode === 'exclude' && isDocLikePath(relPathPosix)) continue;
            if (resolvedDocsMode === 'only' && !isDocLikePath(relPathPosix)) continue;
            if (matchesAny(relPathPosix, compiledExclude)) continue;
            if (shouldFilterByInclude && !matchesAny(relPathPosix, compiledInclude)) continue;

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
                    buffer: buf,
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
