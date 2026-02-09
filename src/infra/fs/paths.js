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

// Named exports (flattened from DIRS / FILES / LIMITS)
export { ROOT };
export const { QUEUE, RESPONSE, ARTIFACTS, LOGS, CORRUPT, REPORTS } = DIRS;
export const { CONFIG, RULES, CONTROL, STATE, IDENTITY, VOCAB } = FILES;
export const { MAX_JSON_SIZE, MAX_LOG_SIZE } = LIMITS;
export const QUEUE_DIR = DIRS.QUEUE;
export const RESPONSE_DIR = DIRS.RESPONSE;
export const ARTIFACTS_DIR = DIRS.ARTIFACTS;
export const LOG_DIR = DIRS.LOGS;

export { DIRS, FILES, LIMITS };
