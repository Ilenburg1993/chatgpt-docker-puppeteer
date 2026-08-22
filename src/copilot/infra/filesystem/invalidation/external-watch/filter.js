// @ts-check
/** Path-domain filtering for external filesystem watch hints. */
import { DEFAULT_BLOCKED_PATH_SEGMENTS } from '#copilot/infra/internal/policy';
import { isAbsolute, relative, resolve } from 'node:path';

const BLOCKED_SEGMENTS = new Set(DEFAULT_BLOCKED_PATH_SEGMENTS.map((segment) => String(segment).toLowerCase()));

/** @param {string} root @param {string} filename */
export function resolveExternalWatchCandidate(root, filename) {
    const normalized = filename.replace(/\\/gu, '/').replace(/^\.\//u, '');
    if (!normalized || isAbsolute(normalized)) return null;
    const absolute = resolve(root, normalized);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
    const segments = rel.replace(/\\/gu, '/').split('/').filter(Boolean);
    if (segments.some((segment) => segment.startsWith('.') || BLOCKED_SEGMENTS.has(segment.toLowerCase()))) return null;
    return absolute;
}
