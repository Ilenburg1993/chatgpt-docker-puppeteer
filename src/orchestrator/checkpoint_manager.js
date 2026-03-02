// @ts-check - Type checking rigoroso habilitado (arquivo core)
import fs from 'fs/promises';
import path from 'node:path';
import * as logger from '#core/logger';

/**
 * CheckpointManager - Gerencia checkpoints de missões para crash recovery.
 *
 * Responsabilidades:
 * 1. Salvar snapshot completo da missão a cada step
 * 2. Manter checkpoint-latest.json para acesso rápido
 * 3. Permitir recovery de crashes (reload from checkpoint)
 * 4. Limpar checkpoints antigos (LRU, keepLast=N)
 * 5. Listar histórico de checkpoints
 *
 * Integração:
 * - MissionManager: Chama saveCheckpoint() após cada step
 * - MissionManager: Chama loadCheckpoint() no initialize() para recovery
 * - MissionStateManager: Fornece mission state completo
 */
class CheckpointManager {
    /**
     * @param {Object} options
     * @param {string} [options.baseDir='missions'] - Diretório base de missões
     * @param {number} [options.keepLast=10] - Quantos checkpoints manter por missão
     * @param {boolean} [options.autoCleanup=true] - Limpar checkpoints antigos automaticamente
     */
    constructor({ baseDir = 'missions', keepLast = 10, autoCleanup = true } = {}) {
        this.baseDir = baseDir;
        this.keepLast = keepLast;
        this.autoCleanup = autoCleanup;

        logger.info(`[CheckpointManager] Initialized (baseDir: ${baseDir}, keepLast: ${keepLast})`);
    }

    /**
     * Salva checkpoint de uma missão.
     *
     * @param {string} missionId - ID da missão
     * @param {number} stepIndex - Índice do step completado
     * @param {Object} missionState - Estado completo da missão
     * @param {Object} [metadata={}] - Metadata adicional (reason, created_by, etc)
     * @returns {Promise<string>} - ID do checkpoint criado
     *
     * @example
     * await checkpointManager.saveCheckpoint('mission-123', 5, missionState, {
     *     reason: 'step_completed',
     *     created_by: 'mission_manager'
     * });
     */
    async saveCheckpoint(missionId, stepIndex, missionState, metadata = {}) {
        const timestamp = Date.now();
        // Ensure uniqueness even when multiple checkpoints are saved within the same millisecond.
        const checkpointId = `checkpoint-${timestamp}-${Math.random().toString(16).slice(2, 8)}`;

        const checkpoint = {
            checkpoint_id: checkpointId,
            mission_id: missionId,
            timestamp,
            step_index: stepIndex,
            mission_state: missionState,
            metadata: {
                ...metadata,
                created_at: new Date(timestamp).toISOString(),
            },
        };

        const checkpointsDir = path.join(this.baseDir, missionId, 'checkpoints');
        await fs.mkdir(checkpointsDir, { recursive: true });

        // Salva checkpoint com timestamp (atomic: write tmp then rename)
        const checkpointPath = path.join(checkpointsDir, `${checkpointId}.json`);
        const tmpCheckpointPath = checkpointPath + '.tmp';
        const checkpointJson = JSON.stringify(checkpoint, null, 2);
        await fs.writeFile(tmpCheckpointPath, checkpointJson);
        await fs.rename(tmpCheckpointPath, checkpointPath);

        // Atualiza checkpoint-latest.json (atomic: write tmp then rename)
        const latestPath = path.join(checkpointsDir, 'checkpoint-latest.json');
        const tmpLatestPath = latestPath + '.tmp';
        await fs.writeFile(tmpLatestPath, checkpointJson);
        await fs.rename(tmpLatestPath, latestPath);

        logger.info(
            `[CheckpointManager] Checkpoint saved: ${missionId} (step ${stepIndex}, checkpoint: ${checkpointId})`
        );

        // Auto-cleanup de checkpoints antigos
        if (this.autoCleanup) {
            await this._cleanupOldCheckpoints(missionId);
        }

        return checkpointId;
    }

    /**
     * Carrega último checkpoint de uma missão.
     *
     * @param {string} missionId - ID da missão
     * @returns {Promise<Object|null>} - Checkpoint ou null se não existir
     *
     * @example
     * const checkpoint = await checkpointManager.loadCheckpoint('mission-123');
     * if (checkpoint) {
     *     const recoveredState = checkpoint.mission_state;
     *     const stepIndex = checkpoint.step_index;
     * }
     */
    async loadCheckpoint(missionId) {
        const latestPath = path.join(this.baseDir, missionId, 'checkpoints', 'checkpoint-latest.json');

        try {
            const data = await fs.readFile(latestPath, 'utf-8');
            const checkpoint = JSON.parse(data);

            // Validate checkpoint structure integrity
            if (!checkpoint || !checkpoint.checkpoint_id || typeof checkpoint.step_index !== 'number') {
                logger.error(`[CheckpointManager] Corrupted checkpoint for ${missionId}: missing required fields`);
                return null;
            }

            logger.info(
                `[CheckpointManager] Checkpoint loaded: ${missionId} (step ${checkpoint.step_index}, checkpoint: ${checkpoint.checkpoint_id})`
            );

            return checkpoint;
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn(`[CheckpointManager] No checkpoint found for mission: ${missionId}`);
                return null;
            }

            logger.error(`[CheckpointManager] Error loading checkpoint for ${missionId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Carrega checkpoint específico por ID.
     *
     * @param {string} missionId - ID da missão
     * @param {string} checkpointId - ID do checkpoint
     * @returns {Promise<Object|null>} - Checkpoint ou null
     */
    async loadCheckpointById(missionId, checkpointId) {
        const checkpointPath = path.join(this.baseDir, missionId, 'checkpoints', `${checkpointId}.json`);

        try {
            const data = await fs.readFile(checkpointPath, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    /**
     * Lista todos os checkpoints de uma missão (ordenados por timestamp desc).
     *
     * @param {string} missionId - ID da missão
     * @returns {Promise<Object[]>} - Lista de metadados de checkpoints
     *
     * @example
     * const checkpoints = await checkpointManager.listCheckpoints('mission-123');
     * // [
     * //   { checkpoint_id, timestamp, step_index, created_at },
     * //   ...
     * // ]
     */
    async listCheckpoints(missionId) {
        const checkpointsDir = path.join(this.baseDir, missionId, 'checkpoints');

        try {
            const files = await fs.readdir(checkpointsDir);

            // Filtra apenas arquivos checkpoint-*.json (exclui checkpoint-latest.json)
            const checkpointFiles = files.filter(f => f.startsWith('checkpoint-') && f !== 'checkpoint-latest.json');

            const checkpoints = [];

            for (const file of checkpointFiles) {
                const filePath = path.join(checkpointsDir, file);
                const data = await fs.readFile(filePath, 'utf-8');
                const checkpoint = JSON.parse(data);

                // Retorna apenas metadata (não o mission_state completo)
                checkpoints.push({
                    checkpoint_id: checkpoint.checkpoint_id,
                    timestamp: checkpoint.timestamp,
                    step_index: checkpoint.step_index,
                    created_at: checkpoint.metadata.created_at,
                });
            }

            // Ordena por timestamp desc (mais recente primeiro)
            checkpoints.sort((a, b) => b.timestamp - a.timestamp);

            return checkpoints;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    /**
     * Deleta checkpoint específico.
     *
     * @param {string} missionId - ID da missão
     * @param {string} checkpointId - ID do checkpoint
     */
    async deleteCheckpoint(missionId, checkpointId) {
        const checkpointPath = path.join(this.baseDir, missionId, 'checkpoints', `${checkpointId}.json`);

        try {
            await fs.unlink(checkpointPath);
            logger.info(`[CheckpointManager] Checkpoint deleted: ${missionId}/${checkpointId}`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error(
                    `[CheckpointManager] Error deleting checkpoint ${missionId}/${checkpointId}: ${error.message}`
                );
            }
        }
    }

    /**
     * Deleta todos os checkpoints de uma missão.
     *
     * @param {string} missionId - ID da missão
     */
    async deleteAllCheckpoints(missionId) {
        const checkpointsDir = path.join(this.baseDir, missionId, 'checkpoints');

        try {
            await fs.rm(checkpointsDir, { recursive: true, force: true });
            logger.info(`[CheckpointManager] All checkpoints deleted: ${missionId}`);
        } catch (error) {
            logger.error(`[CheckpointManager] Error deleting checkpoints for ${missionId}: ${error.message}`);
        }
    }

    /**
     * Verifica se missão tem checkpoints (útil para recovery).
     *
     * @param {string} missionId - ID da missão
     * @returns {Promise<boolean>} - true se tem checkpoint-latest.json
     */
    async hasCheckpoint(missionId) {
        const latestPath = path.join(this.baseDir, missionId, 'checkpoints', 'checkpoint-latest.json');

        try {
            await fs.access(latestPath);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Limpa checkpoints antigos, mantendo apenas os N mais recentes.
     *
     * @param {string} missionId - ID da missão
     * @param {number} [keepLast] - Quantos manter (default: this.keepLast)
     */
    async _cleanupOldCheckpoints(missionId, keepLast = this.keepLast) {
        const checkpoints = await this.listCheckpoints(missionId);

        if (checkpoints.length <= keepLast) {
            return; // Nada a limpar
        }

        // Mantém os N mais recentes, deleta o resto
        const toDelete = checkpoints.slice(keepLast);

        for (const checkpoint of toDelete) {
            await this.deleteCheckpoint(missionId, checkpoint.checkpoint_id);
        }

        logger.info(`[CheckpointManager] Cleaned up ${toDelete.length} old checkpoints for ${missionId}`);
    }

    /**
     * Retorna estatísticas do CheckpointManager.
     *
     * @param {string} [missionId] - ID da missão (opcional, se omitido retorna stats globais)
     * @returns {Promise<Object>} - Estatísticas
     */
    async getStats(missionId = null) {
        if (missionId) {
            const checkpoints = await this.listCheckpoints(missionId);
            const hasLatest = await this.hasCheckpoint(missionId);

            return {
                mission_id: missionId,
                total_checkpoints: checkpoints.length,
                has_latest: hasLatest,
                latest_checkpoint: checkpoints.length > 0 ? checkpoints[0] : null,
            };
        }

        // Stats globais (se baseDir for acessível)
        return {
            base_dir: this.baseDir,
            keep_last: this.keepLast,
            auto_cleanup: this.autoCleanup,
        };
    }
}

export { CheckpointManager };
