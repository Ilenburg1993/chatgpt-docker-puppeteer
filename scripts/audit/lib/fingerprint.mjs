import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * @param {string[]} parts
 * @returns {string}
 */
export function makeFingerprint(parts) {
    const hash = crypto.createHash('sha256');
    hash.update(parts.join('||'));
    return hash.digest('hex').slice(0, 24);
}

/**
 * @param {string} masterPath
 * @returns {number}
 */
export function getMaxBugId(masterPath) {
    if (!fs.existsSync(masterPath)) {
        return 0;
    }

    const content = fs.readFileSync(masterPath, 'utf8');
    const matches = [...content.matchAll(/BUG-(\d{8})-(\d{3})/g)];
    let max = 0;
    for (const match of matches) {
        const numeric = Number(match[2]);
        if (Number.isFinite(numeric) && numeric > max) {
            max = numeric;
        }
    }
    return max;
}

/**
 * @param {Date} now
 * @param {number} sequence
 * @returns {string}
 */
export function makeBugId(now, sequence) {
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const serial = String(sequence).padStart(3, '0');
    return `BUG-${y}${m}${d}-${serial}`;
}
