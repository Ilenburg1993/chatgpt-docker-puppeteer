// @ts-check
/**
 * @module copilot/agent/dialog/state-machine
 * @file FSM mínima do dialog loop.
 *
 *   Esta classe governa somente transições em memória. Persistência, eventos, watchdog e side effects continuam no
 *   DialogLoopManager.
 */

/**
 * @typedef {'inactive' | 'already-stopping' | 'started'} DialogStopTransition
 */

/**
 * Estado operacional do dialog loop.
 */
export class DialogLoopStateMachine {
    /** @type {boolean} */
    #active = false;

    /** @type {boolean} */
    #stopping = false;

    /** @type {boolean} */
    #paused;

    /** @type {boolean} */
    #resuming = false;

    /**
     * @param {{ paused?: boolean }} [initial]
     */
    constructor(initial = {}) {
        this.#paused = Boolean(initial.paused);
    }

    /** @returns {boolean} */
    get active() {
        return this.#active;
    }

    /** @returns {boolean} */
    get stopping() {
        return this.#stopping;
    }

    /** @returns {boolean} */
    get paused() {
        return this.#paused;
    }

    /** @returns {boolean} */
    get resuming() {
        return this.#resuming;
    }

    /** @returns {boolean} */
    get canSendTurn() {
        return this.#active && !this.#stopping;
    }

    /**
     * Marca boot/start ativo e limpa pause em memória.
     */
    activate() {
        this.#active = true;
        this.#stopping = false;
        this.#paused = false;
    }

    /**
     * Marca o loop como inativo após falha, stop, reconnect ou shutdown.
     *
     * FIX: reseta também #resuming e #paused para evitar:
     *
     * - #resuming=true permanente após notifyReconnect() durante resume -> deadlock em beginResume()
     * - #paused=true fantasma após reconnect com loop inativo -> loop nunca reinicia
     */
    deactivate() {
        this.#active = false;
        this.#stopping = false;
        this.#resuming = false;
        this.#paused = false;
    }

    /**
     * Inicia transição de stop.
     *
     * @returns {DialogStopTransition}
     */
    beginStop() {
        if (this.#stopping) return 'already-stopping';
        this.#stopping = true;
        return 'started';
    }

    /**
     * Finaliza stop autorizado.
     */
    finishStop() {
        this.#active = false;
        this.#stopping = false;
    }

    /**
     * Pausa o loop em memória.
     */
    pause() {
        this.#paused = true;
    }

    /**
     * Limpa pause em memória.
     */
    resume() {
        this.#paused = false;
    }

    /**
     * Tenta iniciar uma transição de resume.
     *
     * @returns {boolean}
     */
    beginResume() {
        if (this.#resuming) return false;
        this.#resuming = true;
        return true;
    }

    /**
     * Finaliza transição de resume, mesmo se ela falhar.
     */
    finishResume() {
        this.#resuming = false;
    }

    /**
     * Prepara restart do loop durante resume com PR.
     *
     * FIX: reseta também #resuming para evitar que uma falha de resume deixe #resuming=true, bloqueando futuros
     * beginResume().
     */
    prepareResumeRestart() {
        this.#active = false;
        this.#paused = false;
        this.#stopping = false;
        this.#resuming = false;
    }
}
