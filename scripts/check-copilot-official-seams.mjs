#!/usr/bin/env node
// @ts-check

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET = path.join(ROOT, 'src', 'copilot');
const SESSION_FS_INTERNAL_IMPORT =
    /\bimport\s+[^;]*\s+from\s+['"](?:#copilot\/sdk\/session(?:\/|-)session-fs(?:\.js)?|\.{1,2}\/.*sdk\/session\/session-fs\.js)['"]/;

/** @typedef {{ file: string; line: number; rule: string; text: string }} Finding */

/**
 * @typedef {{
 *     filePrefix?: string;
 *     file?: string;
 *     rule: string;
 *     regex?: RegExp;
 *     patterns?: RegExp[];
 *     allowCommentOnly?: boolean;
 *     message?: string;
 * }} SeamRule
 */

/** @type {SeamRule[]} */
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
        rule: 'boot-steps-must-not-touch-state-io-for-dialog-boot-recovery',
        file: 'src/copilot/agent/session/boot-steps.js',
        patterns: [/\breadStateAsync\(/, /\bpersistStateWithPolicy\(\s*\{\s*dialogPaused:\s*true/s],
        message: 'boot-steps deve delegar a decisão/persistência do dialog boot recovery à façade agent-runtime-state.',
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
        file: 'src/copilot/agent/lifecycle/orchestrators/agent-lifecycle.js',
        rule: 'agent-lifecycle-must-delegate-runtime-state-io',
        patterns: [
            /\breadStateAsync\(/,
            /\bpersistStateWithPolicy\(/,
            /\bcreatePendingQuestionShadow\(/,
            /\bisPendingQuestionShadowExpired\(\s*pendingQuestionShadow/,
        ],
        message: 'agent-lifecycle deve delegar I/O e restauração de runtime state à façade agent-runtime-state.',
    },
    {
        file: 'src/copilot/agent/lifecycle/orchestrators/agent-lifecycle.js',
        rule: 'agent-lifecycle-must-delegate-shutdown-snapshot',
        patterns: [/\bcreateSnapshot\(/, /\bsaveSnapshotAsync\(/],
        message: 'agent-lifecycle deve delegar snapshots de shutdown à façade agent-runtime-state.',
    },
    {
        file: 'src/copilot/agent/event-bridge-wiring.js',
        rule: 'agent-event-bridge-wiring-must-not-read-runtime-managers-directly',
        patterns: [/\bagent\.ctx\.(?:getDialogLoopManagerSnapshot|getHandoffManagerSnapshot)\(/],
        message: 'event-bridge-wiring deve delegar seleção de emitters à façade agent-runtime-event-bridge.',
    },
    {
        filePrefix: `agent${path.sep}session${path.sep}`,
        rule: 'agent-session-must-not-call-raw-sdk-session-create-resume',
        regex: /\bawait\s+client\.(?:createSession|resumeSession)\(/,
    },
    {
        filePrefix: `agent${path.sep}session${path.sep}`,
        rule: 'agent-session-must-not-check-sdk-getmessages-directly',
        regex: /\b(?:session|sdkSession)\.getMessages\b/,
    },
    {
        filePrefix: `agent${path.sep}session${path.sep}keepalive.js`,
        rule: 'agent-keepalive-must-not-touch-raw-sdk-handles',
        regex: /\b(?:client\.(?:ping|start|stop)|session\.send\()|\bclientPing\s*\.call\(/,
    },
    {
        filePrefix: `agent${path.sep}session${path.sep}boot-wiring.js`,
        rule: 'agent-boot-wiring-must-not-map-sdk-lifecycle-constants-directly',
        regex: /\b(?:getAgentSdkLifecycleEvents|getAgentSdkSessionLifecycleEvents|onAgentSdkLifecycleEvents)\b/,
    },
    {
        filePrefix: `agent${path.sep}session${path.sep}boot-wiring.js`,
        rule: 'agent-boot-wiring-must-not-start-raw-sdk-quota-monitor',
        regex: /\bcreateAgentSdkQuotaMonitor\s*\(/,
    },
    {
        filePrefix: `agent${path.sep}always-alive.js`,
        rule: 'always-alive-must-not-touch-state-io-for-shadow-or-sessionid',
        regex: /\b(?:readState\(\)\?\.sessionId|persistStateWithPolicy\(|writeStateAsync\()/,
    },
    {
        filePrefix: `agent${path.sep}always-alive.js`,
        rule: 'always-alive-must-not-touch-ctx-dialog-runtime-directly',
        regex: /\bthis\.ctx\.(?:sendDialogTurn|pauseDialogLoop|isDialogLoopPaused|getDialogPrMetricsSnapshot|getLastPrInfoSnapshot)\(/,
    },
    {
        filePrefix: `agent${path.sep}always-alive.js`,
        rule: 'always-alive-must-not-touch-ctx-runtime-controls-directly',
        regex: /\bthis\.ctx\.(?:getRuntimeStatus|isDialogLoopActive|getHandoffManagerSnapshot|getQueueSnapshot\(\)\.size|getPendingQuestionForStatusSnapshot|getPendingQuestionKind|getPendingQuestionShadowSnapshot|getPendingQuestionShadowKind|getPendingQuestionShadowState|isPendingQuestionShadowExpired|getPendingQuestionShadowAgeMs|getPendingQuestionShadowExpiresAt|getPendingQuestionShadowRemainingMs)\b/,
    },
    {
        filePrefix: `agent${path.sep}always-alive.js`,
        rule: 'always-alive-must-not-touch-ctx-runtime-governance-directly',
        regex: /\bthis\.ctx\.(?:getPermissionModeSnapshot|setPermissionMode|getPermissionCapabilitySnapshot|getContextFactoryCapabilitiesSnapshot|getToolRegistrySnapshot|getToolRegistryEntriesSnapshot)\b/,
    },
    {
        filePrefix: `agent${path.sep}session${path.sep}boot-steps.js`,
        rule: 'boot-steps-must-not-persist-shadow-inline',
        regex: /\bpersistStateWithPolicy\(\s*\{\s*pendingQuestion:\s*null/,
    },
    {
        filePrefix: `agent${path.sep}session${path.sep}boot-steps.js`,
        rule: 'boot-steps-must-not-check-shadow-reaper-state-directly',
        regex: /\bctx\.(?:hasPendingQuestion|hasPendingQuestionShadow|isPendingQuestionShadowExpired)\(/,
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
 * @param {SeamRule} rule
 * @param {string} rel
 * @returns {boolean}
 */
function ruleAppliesToFile(rule, rel) {
    if (rule.file) {
        const targetRel = path.relative(TARGET, path.resolve(ROOT, rule.file));
        return rel === targetRel;
    }
    return typeof rule.filePrefix === 'string' && rel.startsWith(rule.filePrefix);
}

/**
 * @param {string} content
 * @param {number} index
 * @returns {number}
 */
function lineNumberForIndex(content, index) {
    return content.slice(0, Math.max(0, index)).split('\n').length;
}

/**
 * @returns {Finding[]}
 */
export function checkOfficialSeams() {
    /** @type {Finding[]} */
    const findings = [];

    for (const file of walk(TARGET)) {
        const rel = path.relative(TARGET, file);
        const rawContent = fs.readFileSync(file, 'utf8');
        const content = rawContent.split('\n');

        for (const rule of RULES) {
            if (!ruleAppliesToFile(rule, rel)) continue;

            if (rule.patterns) {
                for (const pattern of rule.patterns) {
                    pattern.lastIndex = 0;
                    const match = pattern.exec(rawContent);
                    if (match) {
                        const line = lineNumberForIndex(rawContent, match.index);
                        findings.push({
                            file: rel,
                            line,
                            rule: rule.rule,
                            text: content[line - 1]?.trim() ?? pattern.source,
                        });
                    }
                }
                continue;
            }

            if (rule.regex) {
                const regex = rule.regex;
                content.forEach((line, index) => {
                    if (isCommentOnly(line)) return;
                    regex.lastIndex = 0;
                    if (regex.test(line)) {
                        findings.push({
                            file: rel,
                            line: index + 1,
                            rule: rule.rule,
                            text: line.trim(),
                        });
                    }
                });
            }
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
