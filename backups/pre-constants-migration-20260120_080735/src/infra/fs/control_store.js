/* ==========================================================================
   src/infra/fs/control_store.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Gestão de sinais de controle global (Pausa/Resumo).
========================================================================== */

const { CONTROL_FILE, safeReadJSON } = require('./fs_core');

async function checkControlPause() {
    try {
        const control = await safeReadJSON(CONTROL_FILE);
        return control && control.estado === 'PAUSED';
    } catch (e) {
        return false; // Em caso de erro, assume execução normal
    }
}

module.exports = { checkControlPause };
