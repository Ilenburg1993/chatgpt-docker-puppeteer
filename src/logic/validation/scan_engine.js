/* ==========================================================================
   src/logic/validation/scan_engine.js
   Audit Level: 100 — Industrial Hardening (Async Stream Engine - Platinum)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Orquestrar a leitura eficiente do arquivo e a aplicação
                     simultânea de múltiplas regras de auditoria em um único passo.
   Sincronizado com: format_rules.js (V1.1), physical_rules.js (V1.0),
                     semantic_rules.js (V1.1), fs_utils.js (V2.5).
========================================================================== */

const fs = require('fs');
const fsp = require('fs').promises;
const readline = require('readline');
const { MAX_JSON_SIZE } = require('../../infra/fs/fs_utils');
const { checkPhysicalIntegrity } = require('./rules/physical_rules');
const { evaluateLine, compileForbiddenList } = require('./rules/semantic_rules');
const { validateJSON, validateRegex, validateMarkdownCode } = require('./rules/format_rules');

/**
 * Executa a auditoria completa em uma única passagem de leitura.
 *
 * @param {object} task - Objeto da tarefa (Schema V4).
 * @param {string} filePath - Caminho do arquivo em disco.
 * @param {Array<string>} systemErrorTerms - Termos de erro globais (i18n).
 * @param {AbortSignal} signal - Sinal para interrupção imediata.
 * @returns {Promise<object>} { ok: boolean, reason: string|null }
 */
async function runSinglePassValidation(task, filePath, systemErrorTerms = [], signal = null) {
    let fileStream = null;

    try {
        // 1. AUDITORIA FÍSICA (Metadados Assíncronos)
        const stats = await fsp.stat(filePath);
        const physicalCheck = checkPhysicalIntegrity(task, stats);
        if (!physicalCheck.ok) {return physicalCheck;}

        // 2. PREPARAÇÃO DA VARREDURA
        const userForbidden = task.spec?.validation?.forbidden_terms || [];
        const forbiddenList = compileForbiddenList(systemErrorTerms, userForbidden);
        const formatRequired = task.spec?.validation?.required_format || 'text';
        const patternRequired = task.spec?.validation?.required_pattern;

        // [FIX 1.2] Otimização de Memória: Uso de Array Buffer em vez de String Concatenation
        // Isso evita realocações de memória O(N^2) durante o processamento de arquivos grandes.
        const contentBuffer = [];
        const shouldAccumulate = (stats.size <= MAX_JSON_SIZE);

        // 3. INICIALIZAÇÃO DO STREAM
        fileStream = fs.createReadStream(filePath, { signal });
        const rl = readline.createInterface({
            input: fileStream,
            terminal: false
        });

        // 4. LOOP DE VARREDURA (LINHA A LINHA)
        for await (const line of rl) {
            // Check de aborto manual para garantir interrupção entre linhas
            if (signal?.aborted) {throw new Error('VALIDATION_ABORTED');}

            // A. Check Semântico (Interrompe no primeiro erro detectado - Fail Fast)
            const violation = evaluateLine(line, forbiddenList);
            if (violation) {
                fileStream.destroy();
                return {
                    ok: false,
                    reason: `FORBIDDEN_CONTENT: Detectada recusa ou erro da IA: "${violation}"`
                };
            }

            // B. Acúmulo para Validação de Formato
            if (shouldAccumulate) {
                contentBuffer.push(line);
            }
        }

        // 5. AUDITORIA ESTRUTURAL (Pós-Stream)
        const fullContent = shouldAccumulate ? contentBuffer.join('\n') : '';

        // Se o arquivo era grande demais para o buffer, mas exigia JSON/Regex, falhamos por segurança
        if (!shouldAccumulate && (formatRequired === 'json' || patternRequired)) {
            return {
                ok: false,
                reason: 'FILE_TOO_LARGE: Conteúdo excede o limite (1MB) para validação estrutural.'
            };
        }

        // Validação JSON (Propaga sinal de aborto para o parser)
        if (formatRequired === 'json') {
            const jsonCheck = validateJSON(fullContent, signal);
            if (!jsonCheck.ok) {return jsonCheck;}
        }

        // Validação Markdown
        if (formatRequired === 'markdown' || formatRequired === 'code') {
            const mdCheck = validateMarkdownCode(fullContent);
            if (!mdCheck.ok) {return mdCheck;}
        }

        // Validação de Padrão (Regex - Propaga sinal de aborto)
        if (patternRequired) {
            const regexCheck = validateRegex(fullContent, patternRequired, signal);
            if (!regexCheck.ok) {return regexCheck;}
        }

        return { ok: true, reason: null };

    } catch (scanErr) {
        // Tratamento de interrupção via sinal
        if (scanErr.name === 'AbortError' || scanErr.message === 'VALIDATION_ABORTED') {
            return { ok: false, reason: 'VALIDATION_CANCELLED: Operação interrompida pelo usuário.' };
        }

        return {
            ok: false,
            reason: `VALIDATION_CRASH: Falha no motor de varredura. Erro: ${scanErr.message}`
        };
    } finally {
        // [FIX] Garantia de fechamento de handle (Zero-Leak Policy)
        if (fileStream) {
            fileStream.destroy();
        }
    }
}

module.exports = { runSinglePassValidation };