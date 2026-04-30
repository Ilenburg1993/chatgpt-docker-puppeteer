// @ts-check
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

import { checkOfficialSeams } from '../../../../scripts/check-copilot-official-seams.mjs';

const ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;

/**
 * @param {...string} parts
 * @returns {string}
 */
function srcPath(...parts) {
    return join(ROOT, ...parts);
}

describe('Block B — lifecycle ownership contracts', () => {
    it('agent/lifecycle não chama start/stop/ping/create/resume crus no CopilotClient', () => {
        const findings = checkOfficialSeams().filter(
            (finding) => finding.rule === 'agent-lifecycle-must-not-call-raw-sdk-client-lifecycle',
        );
        assert.deepEqual(findings, []);
    });

    it('agent/session não chama createSession/resumeSession crus no client SDK', () => {
        const findings = checkOfficialSeams().filter(
            (finding) =>
                finding.rule === 'agent-session-must-not-call-raw-sdk-session-create-resume' ||
                finding.rule === 'agent-session-must-not-check-sdk-getmessages-directly',
        );
        assert.deepEqual(findings, []);
    });

    it('keepalive usa ação semântica do runtime em vez de client.ping/session.send crus', () => {
        const findings = checkOfficialSeams().filter(
            (finding) => finding.rule === 'agent-keepalive-must-not-touch-raw-sdk-handles',
        );
        assert.deepEqual(findings, []);

        const src = readFileSync(srcPath('agent', 'session', 'keepalive.js'), 'utf8');
        assert.match(src, /performKeepalive/);
        assert.doesNotMatch(src, /\bclient\.(?:ping|start|stop)\(/);
        assert.doesNotMatch(src, /\bsession\.send\(/);
    });

    it('boot-wiring usa bridges semânticas para lifecycle/quota do SDK, não mapeamentos crus', () => {
        const findings = checkOfficialSeams().filter(
            (finding) =>
                finding.rule === 'agent-boot-wiring-must-not-map-sdk-lifecycle-constants-directly' ||
                finding.rule === 'agent-boot-wiring-must-not-start-raw-sdk-quota-monitor' ||
                finding.rule === 'always-alive-must-not-touch-state-io-for-shadow-or-sessionid' ||
                finding.rule === 'always-alive-must-not-touch-ctx-dialog-runtime-directly' ||
                finding.rule === 'always-alive-must-not-touch-ctx-runtime-controls-directly' ||
                finding.rule === 'always-alive-must-not-touch-ctx-runtime-governance-directly' ||
                finding.rule === 'boot-steps-must-not-persist-shadow-inline' ||
                finding.rule === 'boot-steps-must-not-check-shadow-reaper-state-directly' ||
                finding.rule === 'boot-steps-must-not-touch-state-io-for-dialog-boot-recovery' ||
                finding.rule === 'agent-lifecycle-must-delegate-runtime-state-io' ||
                finding.rule === 'agent-lifecycle-must-delegate-shutdown-snapshot',
        );
        assert.deepEqual(findings, []);

        const src = readFileSync(srcPath('agent', 'session', 'boot-wiring.js'), 'utf8');
        const alwaysAlive = readFileSync(srcPath('agent', 'always-alive.js'), 'utf8');
        const bootSteps = readFileSync(srcPath('agent', 'session', 'boot-steps.js'), 'utf8');
        const bootDialogRecovery = readFileSync(srcPath('agent', 'session', 'boot-dialog-recovery.js'), 'utf8');
        const lifecycle = readFileSync(srcPath('agent', 'lifecycle', 'agent-lifecycle.js'), 'utf8');

        assert.match(src, /attachAgentSdkBootLifecycleBridge/);
        assert.match(src, /startAgentSdkBootQuotaBridge/);
        assert.doesNotMatch(src, /observeAgentSdkSessionLifecycle/);
        assert.doesNotMatch(src, /startAgentSdkQuotaMonitor/);
        assert.match(alwaysAlive, /readAgentRuntimeSessionId/);
        assert.match(alwaysAlive, /clearAgentRuntimePendingQuestionShadow/);
        assert.match(alwaysAlive, /dispatchAgentDialogTurn/);
        assert.match(alwaysAlive, /pauseAgentDialogLoop/);
        assert.match(alwaysAlive, /isAgentDialogLoopPaused/);
        assert.match(alwaysAlive, /readAgentDialogPrMetrics/);
        assert.match(alwaysAlive, /readAgentDialogLastPrInfo/);
        assert.match(alwaysAlive, /readRuntimeControlState/);
        assert.match(alwaysAlive, /readRuntimeInteractionState/);
        assert.match(alwaysAlive, /getRuntimeHandoffManager/);
        assert.match(alwaysAlive, /readRuntimePermissionMode/);
        assert.match(alwaysAlive, /setRuntimePermissionMode/);
        assert.match(alwaysAlive, /readRuntimePermissionCapability/);
        assert.match(alwaysAlive, /readRuntimeContextFactoryCapabilities/);
        assert.match(alwaysAlive, /readRuntimeToolRegistry/);
        assert.match(alwaysAlive, /readRuntimeToolRegistryEntries/);
        assert.doesNotMatch(alwaysAlive, /readState\(\)\?\.sessionId/);
        assert.doesNotMatch(alwaysAlive, /persistStateWithPolicy\(/);
        assert.doesNotMatch(
            alwaysAlive,
            /this\.ctx\.(?:sendDialogTurn|pauseDialogLoop|isDialogLoopPaused|getDialogPrMetricsSnapshot|getLastPrInfoSnapshot)\(/,
        );
        assert.doesNotMatch(
            alwaysAlive,
            /this\.ctx\.(?:getRuntimeStatus|isDialogLoopActive|getHandoffManagerSnapshot|getQueueSnapshot\(\)\.size|getPendingQuestionForStatusSnapshot|getPendingQuestionKind|getPendingQuestionShadowSnapshot|getPendingQuestionShadowKind|getPendingQuestionShadowState|isPendingQuestionShadowExpired|getPendingQuestionShadowAgeMs|getPendingQuestionShadowExpiresAt|getPendingQuestionShadowRemainingMs)\b/,
        );
        assert.doesNotMatch(
            alwaysAlive,
            /this\.ctx\.(?:getPermissionModeSnapshot|setPermissionMode|getPermissionCapabilitySnapshot|getContextFactoryCapabilitiesSnapshot|getToolRegistrySnapshot|getToolRegistryEntriesSnapshot)\b/,
        );
        assert.match(bootSteps, /from ['"]\.\/boot-dialog-recovery\.js['"]/);
        assert.match(bootDialogRecovery, /clearAgentRuntimePendingQuestionShadow\(/);
        assert.match(bootDialogRecovery, /shouldReapAgentRuntimePendingQuestionShadow\(/);
        assert.match(bootDialogRecovery, /markAgentRuntimeDialogPausedForRecovery\(/);
        assert.match(bootDialogRecovery, /shouldScheduleAgentRuntimeDialogBootRecovery\(/);
        assert.doesNotMatch(
            `${bootSteps}\n${bootDialogRecovery}`,
            /persistStateWithPolicy\(\s*\{\s*pendingQuestion:\s*null/,
        );
        assert.doesNotMatch(
            `${bootSteps}\n${bootDialogRecovery}`,
            /persistStateWithPolicy\(\s*\{\s*dialogPaused:\s*true/,
        );
        assert.doesNotMatch(`${bootSteps}\n${bootDialogRecovery}`, /\breadStateAsync\(/);
        assert.doesNotMatch(
            bootDialogRecovery,
            /\bctx\.(?:hasPendingQuestion|hasPendingQuestionShadow|isPendingQuestionShadowExpired)\(/,
        );
        assert.doesNotMatch(
            src,
            /getAgentSdkLifecycleEvents|getAgentSdkSessionLifecycleEvents|onAgentSdkLifecycleEvents/,
        );
        assert.doesNotMatch(src, /createAgentSdkQuotaMonitor\(/);
        assert.match(lifecycle, /restoreAgentRuntimePersistentBootState\(/);
        assert.match(lifecycle, /resetAgentRuntimeGracefulShutdownFlag\(/);
        assert.match(lifecycle, /persistAgentRuntimePrConsumptionSnapshot\(/);
        assert.match(lifecycle, /saveAgentRuntimeShutdownSnapshot\(/);
        assert.match(lifecycle, /persistAgentRuntimeGracefulShutdownState\(/);
        assert.doesNotMatch(lifecycle, /\breadStateAsync\(/);
        assert.doesNotMatch(lifecycle, /\bpersistStateWithPolicy\(/);
        assert.doesNotMatch(lifecycle, /\bcreateSnapshot\(/);
        assert.doesNotMatch(lifecycle, /\bsaveSnapshotAsync\(/);
    });

    it('initializer continua dependendo da façade do agent para o lifecycle vanilla do SDK', () => {
        const src = readFileSync(srcPath('agent', 'session', 'initializer.js'), 'utf8');
        assert.match(src, /resumeOrCreateAgentSdkSession/);
        assert.match(src, /createAgentSdkSessionByClient/);
        assert.match(src, /canReadAgentSdkSessionMessages/);
        assert.doesNotMatch(src, /\bclient\.(?:createSession|resumeSession)\(/);
        assert.doesNotMatch(src, /\bsession\.getMessages\b/);
    });

    it('agent usa portas finas de observabilidade em vez do aggregate observability-port', () => {
        const agentDir = srcPath('agent');
        /** @type {string[]} */
        const violations = [];
        /**
         * @param {string} dir
         * @returns {void}
         */
        function walk(dir) {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const abs = join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(abs);
                    continue;
                }
                if (!entry.isFile() || !entry.name.endsWith('.js') || abs.endsWith('/ports/observability-port.js')) {
                    continue;
                }
                const rel = abs.replace(ROOT, '').replace(/\\/g, '/');
                const src = readFileSync(abs, 'utf8');
                if (/from ['"].*ports\/observability-port\.js['"]/.test(src)) {
                    violations.push(rel);
                }
            }
        }

        walk(agentDir);

        assert.deepEqual(
            violations,
            [],
            `Imports do aggregate observability-port encontrados:\n${violations.join('\n')}`,
        );
        assert.match(readFileSync(srcPath('agent', 'ports', 'observability-port.js'), 'utf8'), /logging-port/);
        assert.match(readFileSync(srcPath('agent', 'ports', 'observability-port.js'), 'utf8'), /metrics-port/);
        assert.match(readFileSync(srcPath('agent', 'ports', 'observability-port.js'), 'utf8'), /tracing-port/);
    });

    it('always-alive delega subsistemas pela superfície runtime interna', () => {
        const alwaysAlive = readFileSync(srcPath('agent', 'always-alive.js'), 'utf8');
        const surface = readFileSync(srcPath('agent', 'agent-runtime-surface.js'), 'utf8');

        assert.match(alwaysAlive, /from '\.\/agent-runtime-surface\.js'/);
        assert.doesNotMatch(alwaysAlive, /from ['"]\.\/(?:dialog|facades|lifecycle|messaging|ports|state)\//);
        assert.doesNotMatch(alwaysAlive, /from ['"]\.\/(?:event-bridge-wiring|health-check|runtime-registry)\.js['"]/);
        assert.match(surface, /from '\.\/lifecycle\/agent-lifecycle\.js'/);
        assert.match(surface, /from '\.\/messaging\/agent-messaging\.js'/);
        assert.match(surface, /from '\.\/facades\/agent-sdk-access\.js'/);
        assert.match(surface, /from '\.\/runtime-registry\.js'/);
    });

    it('agent/dialog não importa state-io diretamente; usa runtime-state semanticamente', () => {
        const dialogDir = srcPath('agent', 'dialog');
        /** @type {string[]} */
        const violations = [];

        /**
         * @param {string} dir
         * @returns {void}
         */
        function walk(dir) {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const abs = join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(abs);
                    continue;
                }
                if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
                const src = readFileSync(abs, 'utf8');
                if (/from ['"].*lifecycle\/state-io\.js['"]/.test(src)) {
                    violations.push(abs.replace(ROOT, '').replace(/\\/g, '/'));
                }
            }
        }

        walk(dialogDir);

        assert.deepEqual(violations, [], `Imports diretos de state-io em dialog:\n${violations.join('\n')}`);
        assert.match(
            readFileSync(srcPath('agent', 'dialog', 'wiring', 'user-input-handler.js'), 'utf8'),
            /persistAgentRuntimePendingQuestionState/,
        );
    });
});
