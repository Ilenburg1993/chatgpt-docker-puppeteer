// @ts-check
/**
 * src/copilot/boot/skills.js
 *
 * Resolucao canonica de skills e arquivos pinados usados no boot.
 *
 * @module copilot/boot/skills
 */

import { resolve } from 'node:path';
import { WORKSPACE_ROOT, resolveWorkspacePath } from './workspace.js';

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
function parseList(value) {
    if (!value) return [];
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * @param {string} path
 * @returns {string}
 */
function resolveMaybeWorkspacePath(path) {
    return resolve(WORKSPACE_ROOT, path);
}

/**
 * @returns {string[]}
 */
export function resolveBootSkillDirectories() {
    const configured = parseList(process.env['COPILOT_SKILL_DIRECTORIES']);
    const dirs = configured.length > 0 ? configured : ['.github/skills'];
    return dirs.map(resolveMaybeWorkspacePath);
}

/**
 * @returns {string[]}
 */
export function resolveBootPinnedContextDirectories() {
    const configured = parseList(process.env['COPILOT_PINNED_CONTEXT_DIRS']);
    const dirs = configured.length > 0 ? configured : ['.github/skills', '.github/instructions'];
    return dirs.map(resolveMaybeWorkspacePath);
}

/**
 * @returns {string[]}
 */
export function resolveBootDisabledSkills() {
    return parseList(process.env['COPILOT_DISABLED_SKILLS']);
}

/**
 * @returns {{
 *     skillDirectories: string[];
 *     pinnedContextDirectories: string[];
 *     disabledSkills: string[];
 *     workspaceSkillsDirectory: string;
 *     workspaceInstructionsDirectory: string;
 * }}
 */
export function readBootSkillConfig() {
    return {
        skillDirectories: resolveBootSkillDirectories(),
        pinnedContextDirectories: resolveBootPinnedContextDirectories(),
        disabledSkills: resolveBootDisabledSkills(),
        workspaceSkillsDirectory: resolveWorkspacePath('.github', 'skills'),
        workspaceInstructionsDirectory: resolveWorkspacePath('.github', 'instructions'),
    };
}
