/* ==========================================================================
   src/infra/queue/scheduler.js
   Audit Level: 700 — Pure Selection Engine (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Algoritmo puro para filtrar e ordenar tarefas elegíveis.
                     Otimizado para alta frequência e grandes volumes.

   CONTRATO DE SOBERANIA:
     - Entrada: Snapshot estável da fila (Array de objetos).
     - Saída: Novo Array ordenado por prioridade e cronologia.
     - Efeitos Colaterais: ABSOLUTAMENTE ZERO.
========================================================================== */

/**
 * Filtra e ordena as tarefas elegíveis para execução imediata.
 *
 * @param {Array} allTasks - Snapshot estável da fila carregado em RAM.
 * @param {string|null} targetFilter - Nome da IA alvo (ex: 'chatgpt').
 * @returns {Array} Lista de tarefas prontas para o motor de execução.
 */
function getNextEligible(allTasks, targetFilter = null) {
    // 1. BLINDAGEM DEFENSIVA
    if (!Array.isArray(allTasks)) {
        throw new TypeError('[SCHEDULER] Entrada inválida: allTasks deve ser um Array.');
    }

    const now = new Date();

    // 2. INDEXAÇÃO O(N) (Resolução de Dependências em O(1))
    // Mapeia IDs para objetos para evitar buscas repetitivas dentro do loop de filtro.
    const taskMap = new Map();
    for (const t of allTasks) {
        if (t?.meta?.id) {
            taskMap.set(t.meta.id, t);
        }
    }

    // 3. FILTRAGEM DE ELEGIBILIDADE
    const eligible = allTasks.filter(t => {
        // Validação de Integridade Mínima (Schema V4 Guard)
        if (!t?.state || !t?.meta || !t?.policy) {return false;}

        // A. Check de Estado: Apenas tarefas pendentes entram no motor
        if (t.state.status !== 'PENDING') {return false;}

        // B. Time-lock (Agendamento): Verifica se a hora de execução já chegou
        if (t.policy.execute_after && new Date(t.policy.execute_after) > now) {
            return false;
        }

        // C. Resolução de Dependências (Cascata de Bloqueio)
        const deps = t.policy.dependencies;
        if (deps && deps.length > 0) {
            for (const depId of deps) {
                const parent = taskMap.get(depId);

                // Se o pai não existe no snapshot, assumimos que ainda não foi criado
                if (!parent) {return false;}

                const pStatus = parent.state.status;

                // Bloqueio Estrito: Se o pai falhou ou foi pulado, o filho fica travado
                // (O Loader eventualmente marcará este filho como SKIPPED)
                if (pStatus === 'FAILED' || pStatus === 'SKIPPED') {return false;}

                // Só libera se o pai estiver concluído com sucesso
                if (pStatus !== 'DONE') {return false;}
            }
        }

        // D. Filtro de Contexto (Target-Aware)
        if (targetFilter && t.spec?.target?.toLowerCase() !== targetFilter.toLowerCase()) {
            return false;
        }

        return true;
    });

    // 4. ORDENAÇÃO SOBERANA
    // Critério 1: Prioridade (Descendente - 100 vem antes de 0)
    // Critério 2: Data de Criação (Ascendente - Mais velha vem antes)
    return eligible.sort((a, b) => {
        const pA = a.meta.priority || 0;
        const pB = b.meta.priority || 0;

        if (pB !== pA) {return pB - pA;}

        // Comparação léxica de strings ISO-8601 (Alta performance)
        if (a.meta.created_at < b.meta.created_at) {return -1;}
        if (a.meta.created_at > b.meta.created_at) {return 1;}
        return 0;
    });
}

module.exports = { getNextEligible };