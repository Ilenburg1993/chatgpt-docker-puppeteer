import fs from 'fs/promises';
import path from 'node:path';
import * as logger from '#core/logger';

/**
 * Status válidos para missões.
 */
const MISSION_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    FAILED: 'failed'
};

/**
 * Diretório raiz para armazenar missões.
 */
const MISSIONS_DIR = path.join(process.cwd(), 'missions');

/**
 * MissionStateManager - Gerencia persistência de missões.
 */
class MissionStateManager {
    constructor({ baseDir = MISSIONS_DIR } = {}) {
        this.baseDir = baseDir;
    }

    /**
     * Inicializa o diretório base de missões.
     */
    async initialize() {
        try {
            await fs.mkdir(this.baseDir, { recursive: true });
            logger.log('INFO', `[MissionStateManager] Diretório inicializado: ${this.baseDir}`);
        } catch (error) {
            logger.log('ERROR', `[MissionStateManager] Falha ao criar diretório: ${error.message}`);
            throw error;
        }
    }

    /**
     * Cria uma nova missão no filesystem.
     *
     * @param {Object} mission - Dados da missão
     * @param {string} mission.id - ID único da missão
     * @param {string} mission.title - Título descritivo
     * @param {string} mission.description - Descrição detalhada
     * @param {Object} mission.workflow - Workflow estruturado
     * @param {Object} mission.config - Configuração (template, params)
     * @returns {Promise<Object>} - State completo da missão
     */
    async createMission(mission) {
        if (!mission || !mission.id) {
            throw new Error('Mission inválida: falta ID');
        }

        const missionDir = path.join(this.baseDir, mission.id);

        // Verifica se já existe
        try {
            await fs.access(missionDir);
            throw new Error(`Mission ${mission.id} já existe`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        // Cria estrutura de diretórios
        await fs.mkdir(missionDir, { recursive: true });
        await fs.mkdir(path.join(missionDir, 'outputs'), { recursive: true });
        await fs.mkdir(path.join(missionDir, 'checkpoints'), { recursive: true });
        await fs.mkdir(path.join(missionDir, 'logs'), { recursive: true });

        // Cria state inicial
        const state = {
            id: mission.id,
            title: mission.title,
            description: mission.description,
            status: MISSION_STATUS.PENDING,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            workflow: mission.workflow,
            progress: {
                current_step: 0,
                total_steps: mission.workflow.steps.length,
                completed_tasks: 0,
                total_tasks: this._calculateTotalTasks(mission.workflow),
                percent: 0
            },
            config: mission.config || {},
            feedback: [],
            checkpoints: [],
            history: [
                {
                    ts: new Date().toISOString(),
                    event: 'MISSION_CREATED',
                    msg: 'Missão criada'
                }
            ]
        };

        // Salva state.json
        await this._saveState(mission.id, state);

        logger.log('INFO', `[MissionStateManager] Missão criada: ${mission.id}`);
        return state;
    }

    /**
     * Lê o estado de uma missão.
     *
     * @param {string} missionId - ID da missão
     * @returns {Promise<Object|null>} - State da missão ou null se não existir
     */
    async getMission(missionId) {
        try {
            const statePath = path.join(this.baseDir, missionId, 'state.json');
            const content = await fs.readFile(statePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }
            logger.log('ERROR', `[MissionStateManager] Erro ao ler missão ${missionId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Lista todas as missões.
     *
     * @param {Object} filters - Filtros opcionais
     * @param {string} [filters.status] - Filtrar por status
     * @returns {Promise<Object[]>} - Array de states
     */
    async listMissions(filters = {}) {
        try {
            const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
            const missionDirs = entries.filter(e => e.isDirectory());

            const missions = [];
            for (const dir of missionDirs) {
                const state = await this.getMission(dir.name);
                if (!state) continue;

                // Aplica filtros
                if (filters.status && state.status !== filters.status) {
                    continue;
                }

                missions.push(state);
            }

            // Ordena por created_at (mais recentes primeiro)
            missions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            return missions;
        } catch (error) {
            logger.log('ERROR', `[MissionStateManager] Erro ao listar missões: ${error.message}`);
            throw error;
        }
    }

    /**
     * Atualiza o estado de uma missão.
     *
     * @param {string} missionId - ID da missão
     * @param {Object} updates - Campos a atualizar
     * @returns {Promise<Object>} - State atualizado
     */
    async updateMission(missionId, updates) {
        const state = await this.getMission(missionId);
        if (!state) {
            throw new Error(`Mission ${missionId} não encontrada`);
        }

        // Merge updates
        const updatedState = {
            ...state,
            ...updates,
            updated_at: new Date().toISOString()
        };

        // Adiciona evento ao histórico se status mudou
        if (updates.status && updates.status !== state.status) {
            updatedState.history.push({
                ts: new Date().toISOString(),
                event: 'STATUS_CHANGED',
                msg: `Status: ${state.status} → ${updates.status}`
            });
        }

        await this._saveState(missionId, updatedState);

        logger.log('INFO', `[MissionStateManager] Missão atualizada: ${missionId}`);
        return updatedState;
    }

    /**
     * Deleta uma missão completamente.
     *
     * @param {string} missionId - ID da missão
     */
    async deleteMission(missionId) {
        const missionDir = path.join(this.baseDir, missionId);

        try {
            await fs.rm(missionDir, { recursive: true, force: true });
            logger.log('INFO', `[MissionStateManager] Missão deletada: ${missionId}`);
        } catch (error) {
            logger.log('ERROR', `[MissionStateManager] Erro ao deletar missão ${missionId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Salva output de um step.
     *
     * @param {string} missionId - ID da missão
     * @param {string} stepId - ID do step
     * @param {string} content - Conteúdo do output
     */
    async saveOutput(missionId, stepId, content) {
        const outputPath = path.join(this.baseDir, missionId, 'outputs', `${stepId}.txt`);

        try {
            await fs.writeFile(outputPath, content, 'utf8');
            logger.log('DEBUG', `[MissionStateManager] Output salvo: ${missionId}/${stepId}`);
        } catch (error) {
            logger.log('ERROR', `[MissionStateManager] Erro ao salvar output: ${error.message}`);
            throw error;
        }
    }

    /**
     * Lê output de um step.
     *
     * @param {string} missionId - ID da missão
     * @param {string} stepId - ID do step
     * @returns {Promise<string|null>} - Conteúdo ou null
     */
    async getOutput(missionId, stepId) {
        const outputPath = path.join(this.baseDir, missionId, 'outputs', `${stepId}.txt`);

        try {
            return await fs.readFile(outputPath, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    /**
     * Salva checkpoint da missão.
     *
     * @param {string} missionId - ID da missão
     * @param {Object} checkpoint - Dados do checkpoint
     */
    async saveCheckpoint(missionId, checkpoint) {
        const checkpointPath = path.join(this.baseDir, missionId, 'checkpoints', 'checkpoint-latest.json');
        const timestampedPath = path.join(
            this.baseDir,
            missionId,
            'checkpoints',
            `checkpoint-${Date.now()}.json`
        );

        try {
            const data = JSON.stringify(checkpoint, null, 2);
            await fs.writeFile(checkpointPath, data, 'utf8');
            await fs.writeFile(timestampedPath, data, 'utf8');

            logger.log('INFO', `[MissionStateManager] Checkpoint salvo: ${missionId}`);
        } catch (error) {
            logger.log('ERROR', `[MissionStateManager] Erro ao salvar checkpoint: ${error.message}`);
            throw error;
        }
    }

    /**
     * Carrega último checkpoint.
     *
     * @param {string} missionId - ID da missão
     * @returns {Promise<Object|null>} - Checkpoint ou null
     */
    async loadCheckpoint(missionId) {
        const checkpointPath = path.join(this.baseDir, missionId, 'checkpoints', 'checkpoint-latest.json');

        try {
            const content = await fs.readFile(checkpointPath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    /**
     * Adiciona feedback à missão.
     *
     * @param {string} missionId - ID da missão
     * @param {string} feedback - Feedback textual
     * @param {Object} [metadata={}] - Metadata adicional (processed_id, category, action_items, patterns)
     */
    async addFeedback(missionId, feedback, metadata = {}) {
        const state = await this.getMission(missionId);
        if (!state) {
            throw new Error(`Mission ${missionId} não encontrada`);
        }

        state.feedback.push({
            ts: new Date().toISOString(),
            content: feedback,
            metadata // Includes: processed_id, category, action_items, patterns
        });

        state.history.push({
            ts: new Date().toISOString(),
            event: 'FEEDBACK_ADDED',
            msg: `Feedback: ${feedback.substring(0, 50)}${metadata.category ? ` (${metadata.category})` : ''}...`
        });

        await this._saveState(missionId, state);
        logger.log('INFO', `[MissionStateManager] Feedback adicionado: ${missionId}`);
    }

    /**
     * Helper: Salva state.json.
     */
    async _saveState(missionId, state) {
        const statePath = path.join(this.baseDir, missionId, 'state.json');
        await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
    }

    /**
     * Helper: Calcula total de tasks de um workflow.
     */
    _calculateTotalTasks(workflow) {
        if (!workflow || !workflow.steps) {
            return 0;
        }

        return workflow.steps.reduce((total, step) => {
            // Cada step pode ter múltiplas iterações
            const maxIterations = step.max_iterations || 1;
            return total + maxIterations;
        }, 0);
    }
}

export { MissionStateManager, MISSION_STATUS };
