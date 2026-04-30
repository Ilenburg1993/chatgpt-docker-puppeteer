// @ts-check
/**
 * @module copilot/agent/dialog/cost-ledger
 * @file Ledger pequeno de consumo de premium requests do dialog loop.
 *
 *   O DialogLoopManager continua decidindo quando boot/resume acontecem; este ledger só mantém contadores e snapshots
 *   para persistência/observabilidade.
 */

/**
 * @typedef {{ boots?: number; resumesWithPR?: number; resumesZeroPR?: number }} DialogCostLedgerInput
 *
 * @typedef {{
 *     boots: number;
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
 * Ledger de PRs consumidos por boot/resume do dialog loop.
 */
export class DialogCostLedger {
    /** @type {{ boots: number; resumesWithPR: number; resumesZeroPR: number }} */
    #counts;

    /**
     * @param {DialogCostLedgerInput | null | undefined} initial
     */
    constructor(initial = null) {
        this.#counts = {
            boots: countFrom(initial?.boots),
            resumesWithPR: countFrom(initial?.resumesWithPR),
            resumesZeroPR: countFrom(initial?.resumesZeroPR),
        };
    }

    /**
     * Registra um boot completo do dialog loop. Boot sempre consome 1 PR.
     *
     * @returns {DialogCostLedgerSnapshot}
     */
    recordBoot() {
        this.#counts.boots++;
        return this.snapshot();
    }

    /**
     * Registra resume preservado, sem PR adicional.
     *
     * @returns {DialogCostLedgerSnapshot}
     */
    recordZeroPrResume() {
        this.#counts.resumesZeroPR++;
        return this.snapshot();
    }

    /**
     * Registra resume com novo boot prompt, consumindo 1 PR.
     *
     * @returns {DialogCostLedgerSnapshot}
     */
    recordPrResume() {
        this.#counts.resumesWithPR++;
        return this.snapshot();
    }

    /**
     * Snapshot estável usado por status, sessão e persistência.
     *
     * @returns {DialogCostLedgerSnapshot}
     */
    snapshot() {
        const { boots, resumesWithPR, resumesZeroPR } = this.#counts;
        return { boots, resumesWithPR, resumesZeroPR, totalPR: boots + resumesWithPR };
    }
}
