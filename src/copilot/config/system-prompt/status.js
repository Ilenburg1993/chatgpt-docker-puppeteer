// @ts-check
/**
 * src/copilot/config/system-prompt/status.js
 *
 * Status/introspecção canônicos do system prompt modular. Expõe configuração efetiva, compatibilidade do SDK, arquivos
 * observados e revisão digestível para troubleshooting e UX sem acoplar bordas a detalhes internos.
 *
 * @module copilot/config/system-prompt/status
 */

import { utf8ByteLength } from '#copilot/infra/public/buffer';
import { readTextFreshTrusted, statPathTrusted } from '#copilot/infra/public/trusted-io';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadLiveSystemPromptSections } from './live-loader.js';
import { readSystemPromptModeState } from './mode.js';
import { buildSystemPromptProfile } from './profile.js';
import { getSystemPromptSdkCompatibility } from './sdk-introspection.js';
import { SECTIONS, SYSTEM_PROMPT_SECTION_FILES, SYSTEM_PROMPT_SECTION_ORDER } from './sections-registry.js';
import { readResolvedSystemPromptUserConfig, readResolvedSystemPromptUserConfigSync } from './user-config.js';

/**
 * @typedef {import('../sdk-config-port.js').SectionOverrideAction} SectionOverrideAction
 *
 * @typedef {import('./user-config.js').ResolvedSystemPromptUserConfig} ResolvedSystemPromptUserConfig
 *
 * @typedef {import('./mode.js').SystemPromptModeState} SystemPromptModeState
 *
 * @typedef {{ ACTION: SectionOverrideAction; CONTENT: string }} StatusSection
 *
 * @typedef {{
 *     path: string;
 *     exists: boolean;
 *     bytes: number | null;
 *     mtimeMs: number | null;
 * }} SystemPromptTrackedFileStatus
 *
 *
 * @typedef {{
 *     sectionId: string;
 *     file: SystemPromptTrackedFileStatus;
 *     action: SectionOverrideAction;
 *     contentBytes: number;
 * }} SystemPromptSectionStatus
 *
 *
 * @typedef {{
 *     configuredMode: import('./user-config.js').SystemPromptMode;
 *     effectiveMode: import('./user-config.js').SystemPromptMode;
 *     runtimeOverrideMode: import('./user-config.js').SystemPromptMode | null;
 *     hasRuntimeOverride: boolean;
 *     effectiveLiveMode: import('./user-config.js').SystemPromptMode;
 *     configPath: string;
 *     autoReload: boolean;
 *     reloadStrategy: import('./user-config.js').SystemPromptReloadStrategy;
 *     liveReloadEnabled: boolean;
 *     liveReloadMechanism: 'sdk-transform' | 'static-snapshot';
 *     reloadBehavior: {
 *         create: 'always';
 *         resume: 'always';
 *         editDuringSession: 'automatic' | 'requires-session-resume';
 *         afterCompact: 'sdk-managed' | 'requires-session-resume';
 *     };
 *     limitations: string[];
 *     appendTextConfigured: boolean;
 *     appendTextBytes: number;
 *     appendFiles: SystemPromptTrackedFileStatus[];
 *     userAppendContentBytes: number;
 *     profile: import('./profile.js').SystemPromptProfile;
 *     sectionCount: number;
 *     sections: SystemPromptSectionStatus[];
 *     sdkCompatibility: ReturnType<typeof getSystemPromptSdkCompatibility>;
 *     revision: {
 *         digest: string;
 *         inputsChangedAt: number | null;
 *         sectionContentBytes: number;
 *         observedFileCount: number;
 *     };
 * }} SystemPromptStatus
 */

/** Snapshot caches hydrated only by async status reads; sync status is a pure in-memory projection. */
const trackedFileStatusSnapshots = new Map();
const trackedAppendTextSnapshots = new Map();

/**
 * @param {string} fileName
 * @returns {string}
 */
function resolveSectionFilePath(fileName) {
    return fileURLToPath(new URL(`./sections/${fileName}`, import.meta.url));
}

/**
 * @param {string} sectionId
 * @returns {{ fileName: string; section: StatusSection }}
 */
function resolveSectionRegistryEntry(sectionId) {
    const fileName = SYSTEM_PROMPT_SECTION_FILES[sectionId];
    const section = SECTIONS[sectionId];
    if (!fileName || !section) {
        throw new TypeError(`[config/system-prompt/status] seção desconhecida: ${sectionId}`);
    }
    return { fileName, section };
}

/**
 * @param {string} path
 * @returns {SystemPromptTrackedFileStatus}
 */
function readTrackedFileStatusSync(path) {
    const snapshot = trackedFileStatusSnapshots.get(path);
    if (snapshot) return { ...snapshot };
    // Section source modules are already imported into this process; before physical status hydration they are known
    // logical inputs, but byte/mtime metadata is intentionally unknown rather than obtained through sync filesystem IO.
    const isLoadedSectionSource = SYSTEM_PROMPT_SECTION_ORDER.some((sectionId) => {
        const fileName = SYSTEM_PROMPT_SECTION_FILES[sectionId];
        return fileName ? resolveSectionFilePath(fileName) === path : false;
    });
    return { path, exists: isLoadedSectionSource, bytes: null, mtimeMs: null };
}

/**
 * @param {string} path
 * @returns {Promise<SystemPromptTrackedFileStatus>}
 */
async function readTrackedFileStatus(path) {
    let snapshot;
    try {
        const info = (await statPathTrusted(path, { caller: 'config.system-prompt.status' })).stats;
        snapshot = { path, exists: true, bytes: info.size, mtimeMs: info.mtimeMs };
    } catch {
        snapshot = { path, exists: false, bytes: null, mtimeMs: null };
    }
    trackedFileStatusSnapshots.set(path, snapshot);
    return { ...snapshot };
}

/**
 * @param {string[]} filePaths
 * @returns {string}
 */
function readUserAppendContentSyncByPaths(filePaths) {
    return filePaths
        .map((filePath) => trackedAppendTextSnapshots.get(filePath) ?? '')
        .map((content) => content.trim())
        .filter(Boolean)
        .join('\n\n');
}

/**
 * @param {string[]} filePaths
 * @returns {Promise<string>}
 */
async function readUserAppendContentByPaths(filePaths) {
    /** @type {string[]} */
    const parts = [];
    for (const filePath of filePaths) {
        try {
            const content = (
                await readTextFreshTrusted(filePath, { caller: 'config.system-prompt.status' })
            ).content.trim();
            trackedAppendTextSnapshots.set(filePath, content);
            if (content) parts.push(content);
        } catch {
            trackedAppendTextSnapshots.delete(filePath);
            // silencioso por design
        }
    }
    return parts.join('\n\n');
}

/**
 * @param {SystemPromptModeState} modeState
 * @param {ResolvedSystemPromptUserConfig} userConfig
 * @param {ReturnType<typeof getSystemPromptSdkCompatibility>} sdkCompatibility
 * @returns {{
 *     effectiveLiveMode: import('./user-config.js').SystemPromptMode;
 *     liveReloadEnabled: boolean;
 *     liveReloadMechanism: 'sdk-transform' | 'static-snapshot';
 *     reloadBehavior: SystemPromptStatus['reloadBehavior'];
 *     limitations: string[];
 * }}
 */
function buildReloadPolicy(modeState, userConfig, sdkCompatibility) {
    const liveReloadEnabled =
        userConfig.autoReload &&
        userConfig.reloadStrategy === 'sdk-transform' &&
        sdkCompatibility.supportsCustomizeMode;

    /** @type {string[]} */
    const limitations = [];
    if (modeState.effectiveMode === 'replace' && liveReloadEnabled) {
        limitations.push(
            'mode=replace live é emulado via customize+replace por seção; depende de o SDK preservar transforms durante compact e turns futuros.',
        );
    }
    if (modeState.effectiveMode === 'replace' && !liveReloadEnabled) {
        limitations.push('mode=replace sem reload live depende de criação/resume para reaplicar o prompt completo.');
    }
    if (!userConfig.autoReload) {
        limitations.push('autoReload=false força snapshot estático até a próxima criação/resume.');
    }
    if (userConfig.reloadStrategy !== 'sdk-transform') {
        limitations.push('reloadStrategy!=sdk-transform desabilita transforms live do SDK.');
    }
    if (!sdkCompatibility.supportsCustomizeMode) {
        limitations.push('SDK sem customize mode impediria auto-reload por seção.');
    }

    return {
        effectiveLiveMode: liveReloadEnabled ? 'customize' : modeState.effectiveMode,
        liveReloadEnabled,
        liveReloadMechanism: liveReloadEnabled ? 'sdk-transform' : 'static-snapshot',
        reloadBehavior: {
            create: 'always',
            resume: 'always',
            editDuringSession: liveReloadEnabled ? 'automatic' : 'requires-session-resume',
            afterCompact: liveReloadEnabled ? 'sdk-managed' : 'requires-session-resume',
        },
        limitations,
    };
}

/**
 * @param {{
 *     sections: Record<string, StatusSection>;
 *     userConfig: ResolvedSystemPromptUserConfig;
 *     modeState: SystemPromptModeState;
 *     sdkCompatibility: ReturnType<typeof getSystemPromptSdkCompatibility>;
 *     appendFiles: SystemPromptTrackedFileStatus[];
 *     userAppendContentBytes: number;
 *     sectionStatuses: SystemPromptSectionStatus[];
 * }} input
 * @returns {SystemPromptStatus}
 */
function finalizeSystemPromptStatus({
    sections,
    userConfig,
    modeState,
    sdkCompatibility,
    appendFiles,
    userAppendContentBytes,
    sectionStatuses,
}) {
    const reloadPolicy = buildReloadPolicy(modeState, userConfig, sdkCompatibility);
    const sectionContentBytes = sectionStatuses.reduce((sum, section) => sum + section.contentBytes, 0);
    /** @type {number | null} */
    let inputsChangedAt = null;
    for (const value of [...appendFiles, ...sectionStatuses.map((section) => section.file)].map(
        (file) => file.mtimeMs,
    )) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        inputsChangedAt = inputsChangedAt === null || value > inputsChangedAt ? value : inputsChangedAt;
    }

    const digest = createHash('sha256')
        .update(
            JSON.stringify({
                mode: modeState.effectiveMode,
                runtimeOverrideMode: modeState.runtimeOverrideMode,
                autoReload: userConfig.autoReload,
                reloadStrategy: userConfig.reloadStrategy,
                appendText: userConfig.appendText,
                profile: buildSystemPromptProfile(userConfig),
                appendFiles: appendFiles.map((file) => ({ path: file.path, exists: file.exists, bytes: file.bytes })),
                sections: SYSTEM_PROMPT_SECTION_ORDER.map((sectionId) => ({
                    sectionId,
                    action: sections[sectionId]?.ACTION ?? 'append',
                    content: sections[sectionId]?.CONTENT ?? '',
                })),
            }),
        )
        .digest('hex')
        .slice(0, 16);

    return {
        configuredMode: modeState.configuredMode,
        effectiveMode: modeState.effectiveMode,
        runtimeOverrideMode: modeState.runtimeOverrideMode,
        hasRuntimeOverride: modeState.hasRuntimeOverride,
        effectiveLiveMode: reloadPolicy.effectiveLiveMode,
        configPath: userConfig.configPath,
        autoReload: userConfig.autoReload,
        reloadStrategy: userConfig.reloadStrategy,
        liveReloadEnabled: reloadPolicy.liveReloadEnabled,
        liveReloadMechanism: reloadPolicy.liveReloadMechanism,
        reloadBehavior: reloadPolicy.reloadBehavior,
        limitations: reloadPolicy.limitations,
        appendTextConfigured: Boolean(userConfig.appendText.trim()),
        appendTextBytes: utf8ByteLength(userConfig.appendText, 'system prompt append text'),
        appendFiles,
        userAppendContentBytes,
        profile: buildSystemPromptProfile(userConfig),
        sectionCount: sectionStatuses.length,
        sections: sectionStatuses,
        sdkCompatibility,
        revision: {
            digest,
            inputsChangedAt,
            sectionContentBytes,
            observedFileCount: appendFiles.length + sectionStatuses.length,
        },
    };
}

/**
 * @returns {SystemPromptStatus}
 */
export function readSystemPromptStatusSync() {
    const userConfig = readResolvedSystemPromptUserConfigSync();
    const modeState = readSystemPromptModeState();
    const sdkCompatibility = getSystemPromptSdkCompatibility();
    const appendFiles = userConfig.appendFiles.map((filePath) => readTrackedFileStatusSync(filePath));
    const userAppendContent = [readUserAppendContentSyncByPaths(userConfig.appendFiles), userConfig.appendText]
        .filter(Boolean)
        .join('\n\n');
    const sectionStatuses = SYSTEM_PROMPT_SECTION_ORDER.map((sectionId) => {
        const { fileName, section } = resolveSectionRegistryEntry(sectionId);
        const file = readTrackedFileStatusSync(resolveSectionFilePath(fileName));
        return {
            sectionId,
            file,
            action: section.ACTION,
            contentBytes: utf8ByteLength(section.CONTENT, 'system prompt section'),
        };
    });

    return finalizeSystemPromptStatus({
        sections: SECTIONS,
        userConfig,
        modeState,
        sdkCompatibility,
        appendFiles,
        userAppendContentBytes: utf8ByteLength(userAppendContent, 'system prompt user append content'),
        sectionStatuses,
    });
}

/**
 * @returns {Promise<SystemPromptStatus>}
 */
export async function readSystemPromptStatus() {
    const userConfig = await readResolvedSystemPromptUserConfig();
    const modeState = readSystemPromptModeState();
    const sdkCompatibility = getSystemPromptSdkCompatibility();
    const [sections, appendFiles, userAppendContent] = await Promise.all([
        loadLiveSystemPromptSections(),
        Promise.all(userConfig.appendFiles.map((filePath) => readTrackedFileStatus(filePath))),
        readUserAppendContentByPaths(userConfig.appendFiles),
    ]);
    const sectionStatuses = await Promise.all(
        SYSTEM_PROMPT_SECTION_ORDER.map(async (sectionId) => {
            const { fileName, section } = resolveSectionRegistryEntry(sectionId);
            return {
                sectionId,
                file: await readTrackedFileStatus(resolveSectionFilePath(fileName)),
                action: sections[sectionId]?.ACTION ?? section.ACTION,
                contentBytes: utf8ByteLength(
                    sections[sectionId]?.CONTENT ?? section.CONTENT,
                    'system prompt live section',
                ),
            };
        }),
    );

    return finalizeSystemPromptStatus({
        sections: /** @type {Record<string, StatusSection>} */ (sections),
        userConfig,
        modeState,
        sdkCompatibility,
        appendFiles,
        userAppendContentBytes: utf8ByteLength(
            [userAppendContent, userConfig.appendText].filter(Boolean).join('\n\n'),
            'system prompt user append content',
        ),
        sectionStatuses,
    });
}
