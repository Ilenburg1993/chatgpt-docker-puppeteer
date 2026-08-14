// @ts-check
/**
 * @module copilot/agent/dialog/cost-ledger
 * @file Ledger de chamadas adicionais de modelo do dialog loop.
 *
 * O ledger não estima billing. Ele registra apenas se boot/resume exigiram uma nova chamada de modelo. As chaves PR
 * antigas continuam aceitas/emitidas como aliases de compatibilidade para snapshots persistidos antes do billing
 * usage-based de 2026.
 */

/**
 * @typedef {{
 *     boots?: number;
 *     resumesWithAdditionalModelCall?: number;
 *     resumesWithoutAdditionalModelCall?: number;
 *     resumesWithPR?: number;
 *     resumesZeroPR?: number;
 * }} DialogCostLedgerInput
 *
 * @typedef {{
 *     boots: number;
 *     resumesWithAdditionalModelCall: number;
 *     resumesWithoutAdditionalModelCall: number;
 *     totalModelCalls: number;
 *     resumesWithPR: number;
 *     resumesZeroPR: number;
 *     totalPR: number;
 * }} DialogCostLedgerSnapshot
 */

/**
 * @param {unknown} value
 * @returns {number}
 */
function countFrom(value) {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * Ledger de novas chamadas de modelo produzidas pelo lifecycle do dialog loop.
 */
export class DialogCostLedger {
    /** @type {{ boots: number; resumesWithAdditionalModelCall: number; resumesWithoutAdditionalModelCall: number }} */
    #counts;

    /**
     * @param {DialogCostLedgerInput | null | undefined} initial
     */
    constructor(initial = null) {
        this.#counts = {
            boots: countFrom(initial?.boots),
            resumesWithAdditionalModelCall: countFrom(
                initial?.resumesWithAdditionalModelCall ?? initial?.resumesWithPR,
            ),
            resumesWithoutAdditionalModelCall: countFrom(
                initial?.resumesWithoutAdditionalModelCall ?? initial?.resumesZeroPR,
            ),
        };
    }

    /**
     * Registra um boot completo do dialog loop. O boot inicia uma nova chamada de modelo, sem afirmar a unidade de
     * billing usada pelo provider.
     *
     * @returns {DialogCostLedgerSnapshot}
     */
    recordBoot() {
        this.#counts.boots++;
        return this.snapshot();
    }

    /** @returns {DialogCostLedgerSnapshot} */
    recordResumeWithoutAdditionalModelCall() {
        this.#counts.resumesWithoutAdditionalModelCall++;
        return this.snapshot();
    }

    /** @returns {DialogCostLedgerSnapshot} */
    recordResumeWithAdditionalModelCall() {
        this.#counts.resumesWithAdditionalModelCall++;
        return this.snapshot();
    }

    /** @deprecated Use recordResumeWithoutAdditionalModelCall(). @returns {DialogCostLedgerSnapshot} */
    recordZeroPrResume() {
        return this.recordResumeWithoutAdditionalModelCall();
    }

    /** @deprecated Use recordResumeWithAdditionalModelCall(). @returns {DialogCostLedgerSnapshot} */
    recordPrResume() {
        return this.recordResumeWithAdditionalModelCall();
    }

    /**
     * Snapshot moderno com aliases PR somente para leitura de consumers antigos durante a migração.
     *
     * @returns {DialogCostLedgerSnapshot}
     */
    snapshot() {
        const { boots, resumesWithAdditionalModelCall, resumesWithoutAdditionalModelCall } = this.#counts;
        const totalModelCalls = boots + resumesWithAdditionalModelCall;
        return {
            boots,
            resumesWithAdditionalModelCall,
            resumesWithoutAdditionalModelCall,
            totalModelCalls,
            // Compatibilidade temporária com estado/UI anteriores a 2026-06.
            resumesWithPR: resumesWithAdditionalModelCall,
            resumesZeroPR: resumesWithoutAdditionalModelCall,
            totalPR: totalModelCalls,
        };
    }
}
