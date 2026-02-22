// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { ensureInfrastructure } from './fs_utils.js';

// Garante que as pastas básicas existam no momento que o módulo é carregado
ensureInfrastructure();

export * from './fs_utils.js';
/** Reexport público: atomicWrite. */
export { atomicWrite } from './atomic_write.js';
/** Reexport público: safeReadJSON. */
export { safeReadJSON } from './safe_read.js';
