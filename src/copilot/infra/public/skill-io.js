// @ts-check
/**
 * Narrow filesystem capability for configured Copilot skills.
 *
 * Skill roots come from boot configuration and may intentionally be absolute paths outside the workspace. Consumers do
 * not receive generic trusted filesystem primitives; they can only discover directory-backed skills and optionally load
 * the canonical `SKILL.md` for a name that was actually discovered under one of those roots.
 *
 * @module copilot/infra/public/skill-io
 */

import { join } from 'node:path';
import {
    listDirectoryNamesFreshTrusted,
    lstatPathTrusted,
    readTextFreshTrusted,
} from './trusted-io.js';

const SKILL_IO_CALLER = 'infra.public.skill-io';

/**
 * @typedef {{ name: string; directory: string; skillPath: string }} ConfiguredSkillRecord
 *
 * @typedef {{
 *     readableDirectoryCount: number;
 *     names: string[];
 *     selected: (ConfiguredSkillRecord & { content: string }) | null;
 * }} ConfiguredSkillCatalog
 */

/**
 * Discover configured skills and optionally load one selected `SKILL.md`.
 *
 * Symlinked skill directories are deliberately ignored. The requested name is never interpolated into a path until an
 * equal directory name has been observed physically, preventing `../` or absolute-path traversal through the tool API.
 *
 * @param {{
 *     skillDirectories: readonly string[];
 *     disabledSkills?: readonly string[];
 *     requestedName?: string | undefined;
 * }} input
 * @returns {Promise<ConfiguredSkillCatalog>}
 */
export async function readConfiguredSkillCatalog(input) {
    const disabled = new Set(input.disabledSkills ?? []);
    /** @type {Map<string, ConfiguredSkillRecord>} */
    const discovered = new Map();
    let readableDirectoryCount = 0;

    for (const skillsDir of input.skillDirectories) {
        let entries;
        try {
            entries = (
                await listDirectoryNamesFreshTrusted(skillsDir, {
                    caller: SKILL_IO_CALLER,
                })
            ).entries;
            readableDirectoryCount += 1;
        } catch {
            continue;
        }

        for (const entryName of entries) {
            if (disabled.has(entryName) || discovered.has(entryName)) continue;
            const childPath = join(skillsDir, entryName);
            try {
                const { stats } = await lstatPathTrusted(childPath, { caller: SKILL_IO_CALLER });
                if (!stats.isDirectory() || stats.isSymbolicLink()) continue;
                discovered.set(entryName, {
                    name: entryName,
                    directory: skillsDir,
                    skillPath: join(childPath, 'SKILL.md'),
                });
            } catch {
                // Directory entries may disappear between enumeration and lstat; discovery is best-effort.
            }
        }
    }

    const names = [...discovered.keys()].sort();
    const requestedName = typeof input.requestedName === 'string' ? input.requestedName : undefined;
    if (!requestedName) return { readableDirectoryCount, names, selected: null };

    const selected = discovered.get(requestedName);
    if (!selected) return { readableDirectoryCount, names, selected: null };
    try {
        const content = (await readTextFreshTrusted(selected.skillPath, { caller: SKILL_IO_CALLER })).content;
        return { readableDirectoryCount, names, selected: { ...selected, content } };
    } catch {
        return { readableDirectoryCount, names, selected: null };
    }
}
