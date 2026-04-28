#!/usr/bin/env node
// @ts-check

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET = path.join(ROOT, 'src', 'copilot');
const SESSION_FS_INTERNAL_IMPORT =
    /\bimport\s+[^;]*\s+from\s+['"](?:#copilot\/sdk\/session(?:\/|-)session-fs(?:\.js)?|\.{1,2}\/.*sdk\/session\/session-fs\.js)['"]/;

/** @typedef {{ file: string; line: number; rule: string; text: string }} Finding */

/** @type {{ filePrefix: string; rule: string; regex: RegExp; allowCommentOnly?: boolean }[]} */
const RULES = [
    {
        filePrefix: `hooks${path.sep}`,
        rule: 'hooks-must-not-import-agent-runtime',
        regex: /\bimport\s+[^;]*\s+from\s+['"](?:#copilot\/agent(?:\/.*)?|\.{1,2}\/.*agent\/.*)['"]/,
    },
    {
        filePrefix: `channel${path.sep}`,
        rule: 'channel-must-not-import-conversation-hub',
        regex: /\bimport\s+[^;]*\s+from\s+['"](?:#copilot\/conversation-hub(?:\/.*)?|\.{1,2}\/.*conversation-hub\/.*)['"]/,
    },
    {
        filePrefix: `channel${path.sep}`,
        rule: 'channel-must-not-import-presentation',
        regex: /\bimport\s+[^;]*\s+from\s+['"](?:#copilot\/presentation(?:\/.*)?|\.{1,2}\/.*presentation\/.*)['"]/,
    },
    {
        filePrefix: `channel${path.sep}`,
        rule: 'channel-must-not-import-edge-adapters',
        regex: /\bimport\s+[^;]*\s+from\s+['"](?:#copilot\/(?:server|terminal)(?:\/.*)?|\.{1,2}\/.*(?:server|terminal)\/.*)['"]/,
    },
    {
        filePrefix: `conversation-hub${path.sep}`,
        rule: 'conversation-hub-must-not-deep-import-agent',
        regex: /\bimport\s+[^;]*\s+from\s+['"](?:#copilot\/agent\/.+|\.{1,2}\/.*agent\/.+)['"]/,
    },
    {
        filePrefix: `presentation${path.sep}`,
        rule: 'presentation-must-not-runtime-import-sdk',
        regex: /\bimport\s+[^;]*\s+from\s+['"](?:@github\/copilot-sdk|#copilot\/sdk(?:\/.*)?|\.{1,2}\/.*sdk\/.*)['"]/,
    },
    {
        filePrefix: `agent${path.sep}lifecycle${path.sep}`,
        rule: 'agent-lifecycle-must-not-call-raw-sdk-client-lifecycle',
        regex: /\bawait\s+(?:client|activeClient)\.(?:start|stop|ping|createSession|resumeSession)\(/,
    },
    {
        filePrefix: `agent${path.sep}session${path.sep}`,
        rule: 'agent-session-must-not-call-raw-sdk-session-create-resume',
        regex: /\bawait\s+client\.(?:createSession|resumeSession)\(/,
    },
];

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
    /** @type {string[]} */
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'logs') continue;
            out.push(...walk(full));
        } else if (entry.isFile() && (full.endsWith('.js') || full.endsWith('.mjs') || full.endsWith('.cjs'))) {
            out.push(full);
        }
    }
    return out;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isCommentOnly(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('*/');
}

/**
 * @returns {Finding[]}
 */
export function checkOfficialSeams() {
    /** @type {Finding[]} */
    const findings = [];

    for (const file of walk(TARGET)) {
        const rel = path.relative(TARGET, file);
        const content = fs.readFileSync(file, 'utf8').split('\n');

        for (const rule of RULES) {
            if (!rel.startsWith(rule.filePrefix)) continue;

            content.forEach((line, index) => {
                if (isCommentOnly(line)) return;
                if (rule.regex.test(line)) {
                    findings.push({
                        file: rel,
                        line: index + 1,
                        rule: rule.rule,
                        text: line.trim(),
                    });
                }
            });
        }

        if (!rel.startsWith(`sdk${path.sep}`)) {
            content.forEach((line, index) => {
                if (isCommentOnly(line)) return;
                if (SESSION_FS_INTERNAL_IMPORT.test(line)) {
                    findings.push({
                        file: rel,
                        line: index + 1,
                        rule: 'non-sdk-must-not-deep-import-session-fs',
                        text: line.trim(),
                    });
                }
            });
        }
    }

    return findings;
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
    const findings = checkOfficialSeams();

    if (findings.length === 0) {
        console.log('[check-copilot-official-seams] OK — seams oficiais respeitados nas fronteiras monitoradas.');
        process.exit(0);
    }

    console.error('[check-copilot-official-seams] Falhas encontradas:');
    for (const finding of findings) {
        console.error(`- src/copilot/${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`);
    }
    process.exit(2);
}
