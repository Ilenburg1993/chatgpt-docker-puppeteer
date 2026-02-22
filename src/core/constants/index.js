// @ts-check - Type checking rigoroso habilitado (arquivo core)
export * from './tasks.js';
export * from './logging.js';
export * from './browser.js';
export * from './shared.js';
/**
 * Reexports explícitos de constantes de driver para compatibilidade de aliases `#core/constants`.
 */
export { DRIVER_DOMAINS, DRIVER_NAMES, ERROR_NAMES } from './shared.js';
