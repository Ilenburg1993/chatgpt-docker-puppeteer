// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { CONTROL, safeReadJSON } from './fs_core.js';
import { STATUS_VALUES } from '#core/constants/tasks';

/** Função exportada: checkControlPause. */
async function checkControlPause() {
    try {
        const control = await safeReadJSON(CONTROL);
        return control && control.estado === STATUS_VALUES.PAUSED;
    } catch (e) {
        return false; // Em caso de erro, assume execução normal
    }
}

export { checkControlPause };
