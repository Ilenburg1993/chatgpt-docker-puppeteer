/* ==========================================================================
   src/logic/validation/rules/physical_rules.js
   Audit Level: 100 — Industrial Hardening (Physical Integrity)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Validar a existência física e o cumprimento de requisitos
                     de tamanho (bytes) do arquivo de resposta.
========================================================================== */

/**
 * Verifica se o arquivo atende aos requisitos físicos mínimos.
 *
 * @param {object} task - Objeto da tarefa (Schema V4).
 * @param {object} stats - Objeto fs.Stats do arquivo em disco.
 * @returns {object} { ok: boolean, reason: string|null }
 */
function checkPhysicalIntegrity(task, stats) {
    // 1. Validação de Existência (Blindagem de Objeto)
    if (!stats) {
        return {
            ok: false,
            reason: 'FILE_NOT_FOUND: Os metadados do arquivo são nulos ou inacessíveis.'
        };
    }

    const fileSize = stats.size;

    // 2. Auditoria de Sanidade (Prevenção de arquivos fantasmas)
    // [FIX] Prioridade Diagnóstica: Se o arquivo tem 0 bytes, é uma falha de I/O ou rede,
    // independentemente do valor de min_length.
    if (fileSize === 0) {
        return {
            ok: false,
            reason: 'EMPTY_FILE: O arquivo foi criado no disco, mas não contém dados.'
        };
    }

    // 3. Extração de Regras (Cura de Defaults)
    const minLength = task?.spec?.validation?.min_length ?? 10;

    // 4. Auditoria de Tamanho Mínimo
    // Um arquivo muito pequeno geralmente indica falha na geração ou resposta incompleta.
    if (fileSize < minLength) {
        return {
            ok: false,
            reason: `TOO_SHORT: O conteúdo gerado (${fileSize} bytes) é inferior ao mínimo exigido (${minLength} bytes).`
        };
    }

    return { ok: true, reason: null };
}

module.exports = { checkPhysicalIntegrity };