// @ts-check
import { STATUS_VALUES } from '#core/constants/tasks';
import { CONTROL, safeReadJSON } from './fs_core.js';

/**
 * Função exportada: checkControlPause.
 *
 * @returns {Promise<any>}
 */
async function checkControlPause() {
    try {
        const control = /** @type {any} */ (await safeReadJSON(CONTROL));
        return control && control.estado === STATUS_VALUES.PAUSED;
    } catch (/** @type {any} */ e) {
        return false; // Em caso de erro, assume execução normal
    }
}

export { checkControlPause };
