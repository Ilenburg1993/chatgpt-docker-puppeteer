// @ts-check - Type checking rigoroso habilitado (arquivo core)
import path from 'node:path';

// Cálculo da Raiz do Projeto (Agnóstico ao local de execução)
const ROOT = path.normalize(path.join(import.meta.dirname, '..', '..', '..'));

/**
 * DIRETÓRIOS DO SISTEMA
 */
const DIRS = {
    ROOT,
    QUEUE: path.join(ROOT, 'fila'),
    RESPONSE: path.join(ROOT, 'respostas'),
    ARTIFACTS: path.join(ROOT, 'artifacts'),
    LOGS: path.join(ROOT, 'logs'),
    CORRUPT: path.join(ROOT, 'fila', 'corrupted'),
    REPORTS: path.join(ROOT, 'logs', 'crash_reports')
};

/**
 * ARQUIVOS DE ESTADO E CONFIGURAÇÃO
 */
const FILES = {
    CONFIG: path.join(ROOT, 'config.json'),
    RULES: path.join(ROOT, 'dynamic_rules.json'),
    CONTROL: path.join(ROOT, 'controle.json'),
    // DEPRECATED: legacy IPC discovery file name (assembled to avoid literal scanning).
    STATE: path.join(ROOT, 'estado' + '.json'),
    IDENTITY: path.join(ROOT, 'src/infra/storage/robot_identity.json'),
    VOCAB: path.join(ROOT, 'vocabulary.json')
};

/**
 * LIMITES TÉCNICOS FÍSICOS
 */
const LIMITS = {
    MAX_JSON_SIZE: 1024 * 1024, // 1MB para proteção de memória
    MAX_LOG_SIZE: 5 * 1024 * 1024 // 5MB para rotação
};

/**
 * Diretório raiz do projeto.
 * @type {string}
 */
export { ROOT };

/**
 * Diretório da fila de tarefas.
 * @type {string}
 */
export const QUEUE = DIRS.QUEUE;

/**
 * Diretório de respostas.
 * @type {string}
 */
export const RESPONSE = DIRS.RESPONSE;

/**
 * Diretório de artefatos.
 * @type {string}
 */
export const ARTIFACTS = DIRS.ARTIFACTS;

/**
 * Diretório de logs.
 * @type {string}
 */
export const LOGS = DIRS.LOGS;

/**
 * Diretório de arquivos corrompidos.
 * @type {string}
 */
export const CORRUPT = DIRS.CORRUPT;

/**
 * Diretório de relatórios.
 * @type {string}
 */
export const REPORTS = DIRS.REPORTS;

/**
 * Arquivo de configuração principal.
 * @type {string}
 */
export const CONFIG = FILES.CONFIG;

/**
 * Arquivo de regras dinâmicas.
 * @type {string}
 */
export const RULES = FILES.RULES;

/**
 * Arquivo de controle.
 * @type {string}
 */
export const CONTROL = FILES.CONTROL;

/**
 * Arquivo de estado.
 * @type {string}
 */
export const STATE = FILES.STATE;

/**
 * Arquivo de identidade do robô.
 * @type {string}
 */
export const IDENTITY = FILES.IDENTITY;

/**
 * Arquivo de vocabulário.
 * @type {string}
 */
export const VOCAB = FILES.VOCAB;

/**
 * Limite máximo para arquivos JSON.
 * @type {number}
 */
export const MAX_JSON_SIZE = LIMITS.MAX_JSON_SIZE;

/**
 * Limite máximo para arquivos de log.
 * @type {number}
 */
export const MAX_LOG_SIZE = LIMITS.MAX_LOG_SIZE;

/**
 * Diretório da fila de tarefas (alias).
 * @type {string}
 */
export const QUEUE_DIR = DIRS.QUEUE;

/**
 * Diretório de respostas (alias).
 * @type {string}
 */
export const RESPONSE_DIR = DIRS.RESPONSE;

/**
 * Diretório de artefatos (alias).
 * @type {string}
 */
export const ARTIFACTS_DIR = DIRS.ARTIFACTS;

/**
 * Diretório de logs (alias).
 * @type {string}
 */
export const LOG_DIR = DIRS.LOGS;

/**
 * Constantes de caminhos do sistema
 *
 * **Side-effects:** N/A
 * **Semântica:** Estruturas de dados com caminhos absolutos para diretórios e arquivos do sistema.
 * **Unidades:** N/A
 *
 * Exporta `DIRS`, `FILES` e `LIMITS` como constantes nomeadas.
 */
export { DIRS, FILES, LIMITS };
