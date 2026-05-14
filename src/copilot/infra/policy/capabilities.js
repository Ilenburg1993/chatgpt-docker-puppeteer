// @ts-check
/**
 * Capabilities canônicas para envelopes agentic e auditabilidade de tools.
 *
 * @module copilot/infra/policy/capabilities
 */

export const IO_CAPABILITY = /** @type {const} */ ({
    fileWrite: 'file.write',
    fileCreate: 'file.create',
    fileCreateOrOverwrite: 'file.create-or-overwrite',
    fileDelete: 'file.delete',
    fileCopy: 'file.copy',
    fileMove: 'file.move',
    filePatch: 'file.patch',
});

/**
 * @param {boolean} overwrite
 * @returns {typeof IO_CAPABILITY.fileCreate | typeof IO_CAPABILITY.fileCreateOrOverwrite}
 */
export function capabilityForCreate(overwrite) {
    return overwrite ? IO_CAPABILITY.fileCreateOrOverwrite : IO_CAPABILITY.fileCreate;
}
