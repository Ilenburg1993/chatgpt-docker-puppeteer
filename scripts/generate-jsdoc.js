#!/usr/bin/env node
// @ts-check

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Script para gerar JSDOC automaticamente para funções que não possuem.
 * Analisa arquivos JavaScript/TypeScript e adiciona JSDOCs básicos onde faltam.
 * Side-effects: Lê e escreve arquivos no sistema de arquivos.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Verifica se um arquivo é JavaScript ou TypeScript.
 * @param {string} filepath - Caminho do arquivo.
 * @returns {boolean} Verdadeiro se for arquivo JS/TS, falso caso contrário.
 */
function isJSFile(filepath) {
    return /\.(js|ts|jsx|tsx)$/.test(filepath) && !filepath.includes('node_modules');
}

/**
 * Extrai funções e métodos de um arquivo JavaScript.
 * @param {string} content - Conteúdo do arquivo.
 * @returns {Array<{name: string, type: string, startLine: number, endLine?: number}>} Lista de funções/métodos encontrados.
 */
function extractFunctions(content) {
    const functions = [];
    const lines = content.split('\n');

    // Regex para detectar diferentes tipos de funções
    const functionPatterns = [
        /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
        /(?:export\s+)?(?:async\s+)?(\w+)\s*:\s*(?:function\s*)?\(/,
        /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/,
        /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function\s*\(/,
        /(\w+)\s*(?:async\s+)?\(\s*\)/,
        /static\s+(\w+)\s*\(/,
        /(?:async\s+)?(\w+)\s*\(/,
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = (lines[i] ?? '').trim();

        // Pular linhas que já têm JSDOC
        if (line.startsWith('/**') || line.includes('* @')) {
            continue;
        }

        // Verificar cada padrão de função
        for (const pattern of functionPatterns) {
            const match = line.match(pattern);
            if (match) {
                const funcName = match[1] ?? '';

                // Verificar se esta função faz parte de uma classe
                let funcType = 'function';
                if (line.includes('constructor')) {
                    funcType = 'constructor';
                } else if (line.includes('static')) {
                    funcType = 'method-static';
                } else if (line.includes('async')) {
                    funcType = 'async-function';
                } else {
                    funcType = 'method';
                }

                functions.push({
                    name: funcName,
                    type: funcType,
                    startLine: i,
                });

                break;
            }
        }
    }

    return functions;
}

/**
 * Gera JSDOC básico para uma função.
 * @param {string} funcName - Nome da função.
 * @param {string} funcType - Tipo da função.
 * @returns {string} String com JSDOC gerado.
 */
function generateJSDoc(funcName, funcType) {
    let params = '';
    let returns = '';

    // Dependendo do tipo, podemos inferir diferentes coisas
    switch (funcType) {
        case 'async-function':
            returns = '\n * @returns {Promise<void>} ';
            break;
        case 'constructor':
            returns = '';
            break;
        default:
            returns = '\n * @returns {object} ';
    }

    return `/**
 * ${funcName} - Descrição da função.
 * Side-effects: Adicione aqui os efeitos colaterais da função se houver.
 *${params}${returns}
 */`;
}

/**
 * Verifica se uma função já tem JSDOC acima dela.
 * @param {string[]} lines - Linhas do arquivo.
 * @param {number} funcStartLine - Linha onde a função começa.
 * @returns {boolean} Verdadeiro se já tiver JSDOC, falso caso contrário.
 */
function hasJSDocAbove(lines, funcStartLine) {
    // Procurar para cima até 5 linhas
    for (let i = funcStartLine - 1; i >= Math.max(0, funcStartLine - 5); i--) {
        const line = (lines[i] ?? '').trim();
        if (line.startsWith('/**')) {
            return true;
        }
        // Se encontrar uma linha vazia ou comentário diferente, parar de procurar
        if (line === '' || line.startsWith('//')) {
            break;
        }
    }
    return false;
}

/**
 * Processa um único arquivo para adicionar JSDOCs.
 * @param {string} filepath - Caminho do arquivo a ser processado.
 * @returns {number} Número de JSDOCs adicionados.
 */
function processFile(filepath) {
    const content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.split('\n');
    const functions = extractFunctions(content);

    let addedCount = 0;
    const newLines = [...lines];

    // Processar funções de trás para frente para manter os índices corretos
    for (let i = functions.length - 1; i >= 0; i--) {
        const func = /** @type {any} */ (functions[i]);

        // Verificar se já tem JSDOC acima
        if (!hasJSDocAbove(lines, func.startLine)) {
            const jsdoc = generateJSDoc(func.name, func.type);

            // Inserir o JSDOC antes da linha da função
            newLines.splice(func.startLine, 0, jsdoc);
            addedCount++;
        }
    }

    if (addedCount > 0) {
        fs.writeFileSync(filepath, newLines.join('\n'), 'utf-8');
        console.log(`📝 Adicionado(s) ${addedCount} JSDOC(s) em: ${filepath}`);
    }

    return addedCount;
}

/**
 * Processa todos os arquivos JS/TS em um diretório recursivamente.
 * @param {string} dir - Diretório para processar.
 * @returns {{totalAdded: number, totalProcessed: number}} Estatísticas de processamento.
 */
function processDirectory(dir) {
    let totalAdded = 0;
    let totalProcessed = 0;

    const items = fs.readdirSync(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            const subDirStats = processDirectory(fullPath);
            totalAdded += subDirStats.totalAdded;
            totalProcessed += subDirStats.totalProcessed;
        } else if (isJSFile(fullPath)) {
            try {
                const added = processFile(fullPath);
                if (added > 0) {
                    totalAdded += added;
                }
                totalProcessed++;
            } catch (error) {
                const _ce = /** @type {any} */ (error);
                console.error(`❌ Erro ao processar ${fullPath}:`, _ce.message);
            }
        }
    }

    return { totalAdded, totalProcessed };
}

/**
 * Função principal do script.
 * Side-effects: Processa arquivos no sistema de arquivos.
 */
function main() {
    console.log('🚀 Iniciando geração automática de JSDOC...\n');

    const startTime = Date.now();
    const stats = processDirectory(ROOT_DIR);
    const endTime = Date.now();

    console.log('\n✅ Processamento concluído!');
    console.log(`📊 Total de arquivos processados: ${stats.totalProcessed}`);
    console.log(`📝 Total de JSDOCs adicionados: ${stats.totalAdded}`);
    console.log(`⏱️  Tempo de execução: ${endTime - startTime}ms`);

    if (stats.totalAdded === 0) {
        console.log('ℹ️  Nenhum JSDOC foi adicionado - talvez os arquivos já estejam devidamente documentados.');
    }
}

// Executar o script se chamado diretamente
if (import.meta.filename === process.argv[1]) {
    main();
}

export { processFile, processDirectory, extractFunctions, generateJSDoc };
