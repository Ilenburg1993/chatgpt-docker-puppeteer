FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\infra\fs\paths.js
PASTA_BASE: infra
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/infra/fs/paths.js
   Audit Level: 700 — Physical Path Authority (Shared Infrastructure)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Centralizar todos os caminhos de diretórios e arquivos.
                     Este módulo é o "Nível Zero": PROIBIDO importar outros
                     módulos do projeto aqui para evitar ciclos.
========================================================================== */

const path = require('path');

// Cálculo da Raiz do Projeto (Agnóstico ao local de execução)
const ROOT = path.normalize(path.join(__dirname, '..', '..', '..'));

/**
 * DIRETÓRIOS DO SISTEMA
 */
const DIRS = {
    ROOT,
    QUEUE:    path.join(ROOT, 'fila'),
    RESPONSE: path.join(ROOT, 'respostas'),
    LOGS:     path.join(ROOT, 'logs'),
    CORRUPT:  path.join(ROOT, 'fila', 'corrupted'),
    REPORTS:  path.join(ROOT, 'logs', 'crash_reports')
};

/**
 * ARQUIVOS DE ESTADO E CONFIGURAÇÃO
 */
const FILES = {
    CONFIG:   path.join(ROOT, 'config.json'),
    RULES:    path.join(ROOT, 'dynamic_rules.json'),
    CONTROL:  path.join(ROOT, 'controle.json'),
    STATE:    path.join(ROOT, 'estado.json'),
    IDENTITY: path.join(ROOT, 'src/infra/storage/robot_identity.json'),
    VOCAB:    path.join(ROOT, 'vocabulary.json')
};

/**
 * LIMITES TÉCNICOS FÍSICOS
 */
const LIMITS = {
    MAX_JSON_SIZE: 1024 * 1024, // 1MB para proteção de memória
    MAX_LOG_SIZE:  5 * 1024 * 1024 // 5MB para rotação
};

module.exports = {
    ...DIRS,
    ...FILES,
    ...LIMITS,
    // Atalhos para compatibilidade
    QUEUE_DIR: DIRS.QUEUE,
    RESPONSE_DIR: DIRS.RESPONSE,
    LOG_DIR: DIRS.LOGS
};