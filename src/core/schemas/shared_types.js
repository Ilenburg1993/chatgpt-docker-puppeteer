/* ==========================================================================
   src/core/schemas/shared_types.js
   Audit Level: 100 — Industrial Hardening (Atomic Type Definitions - Platinum)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Definição de tipos primitivos universais e regras de 
                     sanitização atômica para todo o ecossistema.
   Sincronizado com: fs_utils.js (V2.5), task_healer.js (V1.1).
========================================================================== */

const { z } = require('zod');
const { cleanText } = require('../../infra/fs/fs_utils');

/**
 * ID_SCHEMA: Regra estrita para identificadores.
 * [FIX 1.1] Proíbe IDs que comecem com ponto (.) para evitar arquivos ocultos
 * e garante compatibilidade absoluta com sistemas de arquivos Windows/Linux.
 */
const ID_SCHEMA = z.string()
    .regex(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/, "ID inválido: Não pode ser vazio, começar com ponto ou conter caracteres especiais.")
    .min(1, "ID não pode ser vazio.")
    .max(64, "ID excede o limite de 64 caracteres.");

/**
 * TIMESTAMP_SCHEMA: Padronização absoluta para datas ISO-8601.
 * [FIX 1.2] Integridade Temporal: Valida estritamente se a string fornecida é uma data válida.
 * Gera uma nova data APENAS se o valor for omitido (undefined), impedindo que datas
 * malformadas sejam mascaradas como 'agora'.
 */
const TIMESTAMP_SCHEMA = z.string()
    .datetime({ message: "Data inválida: Deve seguir o padrão ISO-8601." })
    .default(() => new Date().toISOString());

/**
 * CLEAN_STRING_SCHEMA: O "Filtro Atômico".
 * Aplica automaticamente a sanitização centralizada do fs_utils.
 */
const CLEAN_STRING_SCHEMA = z.string()
    .transform(val => cleanText(val));

/**
 * PRIORITY_SCHEMA: Controle de urgência.
 * Range: 0 (Baixa) a 100 (Crítica). Default: 5.
 */
const PRIORITY_SCHEMA = z.number()
    .int()
    .min(0)
    .max(100)
    .default(5);

/**
 * SOURCE_SCHEMA: Origem da intenção.
 */
const SOURCE_SCHEMA = z.enum([
    'manual',           
    'api',              
    'gui',              
    'flow_manager',     
    'self_generated',   
    'bulk_import'       
]).default('manual');

/**
 * STATUS_SCHEMA: Estados permitidos no ciclo de vida.
 */
const STATUS_SCHEMA = z.enum([
    'PENDING',    
    'RUNNING',    
    'DONE',       
    'FAILED',     
    'PAUSED',     
    'SKIPPED',    
    'STALLED'     
]).default('PENDING');

module.exports = {
    ID_SCHEMA,
    TIMESTAMP_SCHEMA,
    CLEAN_STRING_SCHEMA,
    PRIORITY_SCHEMA,
    SOURCE_SCHEMA,
    STATUS_SCHEMA
};