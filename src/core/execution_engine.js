/* ==========================================================================
   src/core/execution_engine.js
   Audit Level: 800 — Sovereign Execution Kernel v1.8.0 (Remediation Ready)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Máquina de estados pura para orquestração de ciclos,
                     telemetria de alta fidelidade e execução de manobras
                     de autocura (Self-Healing).
   Sincronizado com: forensics.js V710, infra_failure_policy.js V700, 
                     ipc_client.js V600, io.js V730, config.js V740.
========================================================================== */

const path = require('path');
const fs = require('fs').promises;
const { log, audit } = require('./logger');
const CONFIG = require('./config');

// Camadas de Aplicação e Infraestrutura
const io = require('../infra/io');
const schemas = require('./schemas/schema_core');
const context = require('./context/context_core');
const forensics = require('./forensics');
const validator = require('../logic/validator');
const adaptive = require('../logic/adaptive');

// Shared Kernel IPC 2.0
const { IPCEvent, IPCCommand } = require('../shared/ipc/constants');
const ipc = require('../infra/ipc_client');

// Gestão de Driver
const DriverLifecycleManager = require('../driver/DriverLifecycleManager');

const sleep = ms => new Promise(r => setTimeout(r, ms));

class ExecutionEngine {
    /**
     * @param {object} deps - Injeção de dependências para isolamento de soberania.
     */
    constructor({ orchestrator, environmentResolver, infraFailurePolicy }) {
        if (!orchestrator || !environmentResolver || !infraFailurePolicy) {
            throw new Error('[ENGINE] Dependências críticas incompletas no construtor.');
        }

        this.orchestrator = orchestrator;
        this.environmentResolver = environmentResolver;
        this.infraFailurePolicy = infraFailurePolicy;

        this.activeLifecycle = null;
        this.isRunning = false;
        this.isPaused = false;

        this.state = {
            consecutiveInfraFailures: 0,
            consecutiveTaskFailures: 0,
            currentTaskId: null,
            activeTarget: null,
            lastStatus: null,
            taskSaveThrottle: new Map()
        };
    }

    /* ======================================================================
       INTERFACE DE CONTROLE E REMEDIAÇÃO (IPC 2.0)
    ====================================================================== */

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        log('INFO', '🚀 Execution Engine v1.8.0 Online (Remediation Ready)');
        ipc.emitEvent(IPCEvent.AGENT_READY, { status: 'OPERATIONAL', pid: process.pid });
        
        await this._runLoop();
    }

    async stop() {
        log('WARN', '[ENGINE] Parando Motor...');
        this.isRunning = false;

        if (this.activeLifecycle) {
            await this.activeLifecycle.release();
        }

        await this.orchestrator.cleanup();
    }

    pause() {
        if (!this.isPaused) {
            log('INFO', '[ENGINE] Motor Pausado.');
            this.isPaused = true;
            ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'ENGINE_PAUSED' });
        }
    }

    resume() {
        if (this.isPaused) {
            log('INFO', '[ENGINE] Motor Retomado.');
            this.isPaused = false;
            ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'ENGINE_RESUMED' });
        }
    }

    /**
     * [REMEDIAÇÃO] Aborta a tarefa atual e limpa o ciclo de vida do Driver.
     */
    async abortTask(taskId) {
        if (this.state.currentTaskId === taskId && this.activeLifecycle) {
            log('WARN', `[ENGINE] Abortando tarefa ativa por comando remoto: ${taskId}`);
            await this.activeLifecycle.release();
            ipc.emitEvent(IPCEvent.TASK_FAILED, { taskId, error: 'REMOTE_ABORT_SIGNAL' });
        }
    }

    /**
     * [REMEDIAÇÃO] Reinicia a infraestrutura física (Navegador).
     */
    async rebootInfrastructure(correlationId) {
        log('FATAL', '[ENGINE] Executando manobra de REBOOT de infraestrutura...', correlationId);
        
        // 1. Interrompe o motor temporariamente
        const wasRunning = this.isRunning;
        this.isRunning = false;

        // 2. Executa o Kill cirúrgico via Policy
        if (this.activeLifecycle) await this.activeLifecycle.release();
        const ctx = await this.orchestrator.acquireContext().catch(() => null);
        await this.infraFailurePolicy.escalate({ 
            ctx, 
            reason: 'BROWSER_REBOOT_COMMAND', 
            correlationId 
        });

        // 3. Reinicia o motor
        if (wasRunning) {
            this.isRunning = true;
            ipc.emitEvent(IPCEvent.AGENT_READY, { status: 'RECOVERED_AFTER_REBOOT' }, correlationId);
            this._runLoop();
        }
    }

    /**
     * [REMEDIAÇÃO] Limpa os caches de percepção e DNA.
     */
    async clearCaches(correlationId) {
        log('INFO', '[ENGINE] Executando limpeza de caches genômicos...', correlationId);
        if (io.invalidateDnaCache) io.invalidateDnaCache();
        ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'CACHE_CLEANED' }, correlationId);
    }

    /* ======================================================================
       CORE LOOP
    ====================================================================== */

    async _runLoop() {
        while (this.isRunning) {
            try {
                if (this.isPaused || await io.checkControlPause()) {
                    await sleep(CONFIG.PAUSED_SLEEP); 
                    continue;
                }

                const delay = this._calculateBackoff();
                if (delay > 5000) {
                    log('WARN', `[ENGINE] Resfriamento: ${Math.round(delay / 1000)}s`);
                    await sleep(delay);
                }

                await this._executeCycle();
                await sleep(CONFIG.CYCLE_DELAY);

            } catch (fatalErr) {
                log('FATAL', `[ENGINE] Colapso no Loop: ${fatalErr.message}`);
                await sleep(10000);
            }
        }
    }

    /* ======================================================================
       CICLO UNITÁRIO DE TRABALHO
    ====================================================================== */

    async _executeCycle() {
        this.state.currentTaskId = null;
        this.state.activeTarget = null;

        // A. AQUISIÇÃO DE CONTEXTO FÍSICO
        let ctx;
        try {
            const acquisitionTimeout = this.state.consecutiveInfraFailures === 0 ? 180000 : 120000;
            ctx = await Promise.race([
                this.orchestrator.acquireContext(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('INFRA_ACQUISITION_TIMEOUT')), acquisitionTimeout))
            ]);
            this.state.consecutiveInfraFailures = 0;
        } catch (infraErr) {
            this.state.consecutiveInfraFailures++;
            log('ERROR', `[ENGINE] Falha de Infraestrutura: ${infraErr.message}`);
            return;
        }

        // B. RESOLUÇÃO DE AMBIENTE
        const env = this.environmentResolver.resolve(ctx);
        if (!env.target || env.confidence < CONFIG.MIN_ENV_CONFIDENCE) {
            ipc.emitEvent(IPCEvent.SADI_SNAPSHOT, { status: 'IDLE_SCANNING', url: ctx.page?.url(), reason: env.reason });
            await sleep(CONFIG.UNKNOWN_ENV_SLEEP);
            return;
        }
        this.state.activeTarget = env.target;

        // C. INGESTÃO DE TAREFA
        const rawTask = await io.loadNextTask(env.target);
        if (!rawTask) return;

        this.state.currentTaskId = rawTask.meta?.id || rawTask.id || 'unknown';
        const correlationId = rawTask.meta?.correlation_id || this.state.currentTaskId;

        // D. CURA E VALIDAÇÃO DE SCHEMA
        let task;
        try {
            task = schemas.parseTask(rawTask);
        } catch (schemaErr) {
            log('ERROR', `Tarefa ${this.state.currentTaskId} rejeitada por integridade.`, correlationId);
            ipc.emitEvent(IPCEvent.TASK_FAILED, { taskId: this.state.currentTaskId, error: `SCHEMA_VIOLATION: ${schemaErr.message}` }, correlationId);
            rawTask.state = { status: 'FAILED', last_error: `Schema Violation: ${schemaErr.message}` };
            await io.saveTask(rawTask);
            return;
        }

        // E. LOCK DE EXCLUSÃO MÚTUA
        if (!await io.acquireLock(this.state.currentTaskId, this.state.activeTarget)) {
            await sleep(2000);
            return;
        }

        // --- INÍCIO DA MISSÃO ---
        const startTime = Date.now();
        log('INFO', `>>> Processando: ${this.state.currentTaskId}`, correlationId);
        
        ipc.emitEvent(IPCEvent.TASK_STARTED, { taskId: this.state.currentTaskId, target: this.state.activeTarget }, correlationId);
        audit('TASK_START', { id: this.state.currentTaskId, target: this.state.activeTarget });

        task.state.status = 'RUNNING';
        task.state.started_at = new Date().toISOString();
        task.state.attempts++;
        await this._smartSave(task, true);

        this.activeLifecycle = new DriverLifecycleManager(ctx.page, task, CONFIG.all);

        try {
            await this._executeTaskPipeline(task, ctx, startTime, correlationId);
            this.state.consecutiveTaskFailures = 0;

        } catch (taskErr) {
            this.state.consecutiveTaskFailures++;
            log('ERROR', `[ENGINE] Falha na tarefa: ${taskErr.message}`, correlationId);
            
            ipc.emitEvent(IPCEvent.TASK_FAILED, { taskId: this.state.currentTaskId, error: taskErr.message }, correlationId);

            try { await forensics.createCrashDump(ctx.page, taskErr, this.state.currentTaskId, correlationId); } catch (e) {}

            const isInfraFailure = taskErr.message?.includes('TARGET_CLOSED') || 
                                   taskErr.message?.includes('BROWSER_FROZEN') ||
                                   taskErr.message?.includes('OPERATION_ABORTED');
            
            if (isInfraFailure) {
                await this.infraFailurePolicy.escalate({ ctx, reason: taskErr.message, error: taskErr, correlationId });
                this.state.consecutiveInfraFailures++;
            }

            task.state.status = 'FAILED';
            task.state.last_error = taskErr.message;
            task.state.history.push({ ts: new Date().toISOString(), event: 'FAILURE', msg: taskErr.message });
            await this._smartSave(task, true);

        } finally {
            if (this.activeLifecycle) await this.activeLifecycle.release();
            this.activeLifecycle = null;
            await io.releaseLock(this.state.activeTarget, this.state.currentTaskId).catch(() => {});
            this.state.taskSaveThrottle.delete(this.state.currentTaskId);
            if (global.gc) global.gc();
        }
    }

    /* ======================================================================
       PIPELINE DE EXECUÇÃO DA TAREFA
    ====================================================================== */

    async _executeTaskPipeline(task, ctx, startTime, correlationId) {
        const driver = await this.activeLifecycle.acquire();

        // 1. RESOLUÇÃO DE CONTEXTO
        ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'CONTEXT_RESOLUTION' }, correlationId);
        const userMsg = await Promise.race([
            context.resolveContext(task.spec.payload.user_message, task, this.activeLifecycle.signal),
            new Promise((_, rej) => setTimeout(() => rej(new Error('CONTEXT_RESOLUTION_TIMEOUT')), CONFIG.CONTEXT_RESOLUTION_TIMEOUT))
        ]);
        const sysMsg = await Promise.race([
            context.resolveContext(task.spec.payload.system_message, task, this.activeLifecycle.signal),
            new Promise((_, rej) => setTimeout(() => rej(new Error('CONTEXT_RESOLUTION_TIMEOUT')), CONFIG.CONTEXT_RESOLUTION_TIMEOUT))
        ]);
        
        const finalPrompt = sysMsg ? `[SYSTEM]\n${sysMsg}\n[END]\n\n${userMsg}` : userMsg;

        // 2. EXECUÇÃO FÍSICA
        ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'DRIVER_READY' }, correlationId);
        await driver.prepareContext(task.spec, this.activeLifecycle.signal);
        
        const startSnapshot = await driver.captureState();
        const t0_prompt = Date.now();
        
        ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'SENDING_PROMPT' }, correlationId);
        await driver.sendPrompt(finalPrompt, this.state.currentTaskId, this.activeLifecycle.signal);

        // 3. COLETA
        ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'AWAITING_COMPLETION' }, correlationId);
        const resultData = await driver.waitForCompletion(startSnapshot, this.activeLifecycle.signal);
        
        const duration_ms = Date.now() - startTime;
        adaptive.recordMetric('ttft', Date.now() - t0_prompt, this.state.activeTarget);

        const finalContent = this._normalizeDriverOutput(resultData);
        
        // 4. VALIDAÇÃO DE QUALIDADE
        ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'QUALITY_VALIDATION' }, correlationId);
        
        const safeId = io.sanitizeFilename(this.state.currentTaskId);
        const bufferPath = path.join(io.RESPONSE_DIR, `${safeId}.tmp`);
        const finalPath = path.join(io.RESPONSE_DIR, `${safeId}.txt`);
        
        await fs.writeFile(bufferPath, finalContent, 'utf-8');

        const quality = await validator.validateTaskResult(task, bufferPath, this.activeLifecycle.signal);
        if (!quality.ok) throw new Error(`QUALITY_REJECTED: ${quality.reason}`);

        await this._asyncResilientCommit(bufferPath, finalPath);

        // 5. FINALIZAÇÃO
        task.state.status = 'DONE';
        task.state.completed_at = new Date().toISOString();
        task.state.metrics.duration_ms = duration_ms;
        task.result = { file_path: finalPath, session_url: ctx.page.url() };

        await this._smartSave(task, true);
        await driver.commitLearning();
        
        ipc.emitEvent(IPCEvent.TASK_COMPLETED, { taskId: this.state.currentTaskId, duration: duration_ms }, correlationId);
        audit('TASK_COMPLETE', { id: this.state.currentTaskId, duration: duration_ms });
    }

    /* ======================================================================
       HELPERS PRIVADOS
    ====================================================================== */

    _calculateBackoff() {
        const taskFailures = Math.min(this.state.consecutiveTaskFailures, 20);
        const infraFailures = Math.min(this.state.consecutiveInfraFailures, 30);
        const baseDelay = (taskFailures * 15000) + (infraFailures * 10000);
        return Math.min(600000, baseDelay + (Math.random() * 5000));
    }

    _normalizeDriverOutput(data) {
        if (!data) return "";
        if (typeof data === 'string') return data;
        return data.text || data.content || JSON.stringify(data);
    }

    async _smartSave(task, force = false) {
        const now = Date.now();
        const taskId = task.meta.id;
        const lastSave = this.state.taskSaveThrottle.get(taskId) || 0;
        const statusChanged = task.state.status !== this.state.lastStatus;
        
        if (force || statusChanged || (now - lastSave > 2500)) {
            try {
                await io.saveTask(task);
                this.state.taskSaveThrottle.set(taskId, now);
                this.state.lastStatus = task.state.status;
            } catch (ioErr) { 
                log('ERROR', `[ENGINE] Falha na persistência: ${ioErr.message}`, taskId);
            }
        }
    }

    async _asyncResilientCommit(oldPath, newPath) {
        for (let i = 0; i < 3; i++) {
            try {
                await fs.access(newPath).then(() => fs.unlink(newPath)).catch(() => {});
                await fs.rename(oldPath, newPath);
                return true;
            } catch (err) {
                if (err.code === 'EXDEV') {
                    await fs.copyFile(oldPath, newPath);
                    await fs.unlink(oldPath);
                    return true;
                }
                await sleep(1000 * (i + 1));
            }
        }
        throw new Error(`COMMIT_FAILED: ${path.basename(newPath)}`);
    }
}

module.exports = ExecutionEngine;