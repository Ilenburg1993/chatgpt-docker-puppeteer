import { promises as fs } from 'node:fs';
import path from 'node:path';

const CANON_DB_DIR = '/home/node/.local/share/rag-db';
const CANON_INDEX_DIR = '/home/node/.local/share/rag-index';

export function getRagPaths(overrides = {}) {
    const dbDir = overrides.dbDir || CANON_DB_DIR;
    const indexDir = overrides.indexDir || CANON_INDEX_DIR;
    return {
        dbDir,
        indexDir,
        manifestPath: overrides.manifestPath || path.join(indexDir, 'manifest.v1.json'),
        lockPath: overrides.lockPath || path.join(indexDir, 'index.lock'),
    };
}

export async function ensureDirs(paths) {
    await fs.mkdir(paths.dbDir, { recursive: true });
    await fs.mkdir(paths.indexDir, { recursive: true });
}

export async function atomicWriteJson(filePath, data) {
    const dir = path.dirname(filePath);
    const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(tmpPath, json, 'utf8');
    await fs.rename(tmpPath, filePath);
}

function isProcessAlive(pid) {
    const parsed = Number.parseInt(String(pid ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    try {
        process.kill(parsed, 0);
        return true;
    } catch (error) {
        if (error?.code === 'ESRCH') return false;
        return true;
    }
}

export async function acquireIndexLock(paths, { staleAfterMs = 6 * 60 * 60 * 1000 } = {}) {
    const now = Date.now();
    try {
        const handle = await fs.open(paths.lockPath, 'wx');
        await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: now }, null, 2), 'utf8');
        await handle.close();
        return { acquired: true, staleRecovered: false };
    } catch (err) {
        if (err?.code !== 'EEXIST') {
            throw err;
        }
    }

    try {
        const stat = await fs.stat(paths.lockPath);
        const lockRaw = await fs.readFile(paths.lockPath, 'utf8').catch(() => null);
        let lockJson = null;
        if (lockRaw) {
            try {
                lockJson = JSON.parse(lockRaw);
            } catch {
                lockJson = null;
            }
        }
        const alive = isProcessAlive(lockJson?.pid);
        if (alive === false) {
            await fs.unlink(paths.lockPath);
            return acquireIndexLock(paths, { staleAfterMs });
        }
        const ageMs = now - stat.mtimeMs;
        if (ageMs <= staleAfterMs) {
            return { acquired: false, staleRecovered: false, reason: 'LOCKED', ageMs, lock: lockJson || null };
        }
        await fs.unlink(paths.lockPath);
        return acquireIndexLock(paths, { staleAfterMs });
    } catch (err) {
        return { acquired: false, staleRecovered: false, reason: 'LOCK_UNKNOWN', error: String(err?.message || err) };
    }
}

export async function releaseIndexLock(paths) {
    await fs.unlink(paths.lockPath).catch(() => {});
}
