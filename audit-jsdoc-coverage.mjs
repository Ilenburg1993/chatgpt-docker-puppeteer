#!/usr/bin/env node

// @ts-check
/**
 * Script para auditoria de cobertura JSDoc no projeto
 * Identifica arquivos com exports que precisam de JSDoc
 *
 * Uso: node audit-jsdoc-coverage.mjs
 *
 * Este script:
 * 1. Varre todas as pastas relevantes do projeto
 * 2. Identifica arquivos .js com exports
 * 3. Verifica se têm JSDoc adequado
 * 4. Gera relatório detalhado de cobertura
 * 5. Salva relatório JSON para referência
 *
 * Critérios de JSDoc adequado:
 * - Exports nomeados devem ter JSDoc imediatamente antes
 * - Exports default simples são considerados adequados
 * - Arquivos sem exports não são analisados
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Pastas a serem auditadas
 */
const TARGET_FOLDERS = [
    'src/nerv',
    'src/server/api/controllers',
    'src/infra',
    'src/logic',
    'src/validation',
    'src/orchestrator',
    'src/driver',
    'src/server/handlers',
    // Removido: 'src/server/main.js' - não é diretório
];

/**
 * Lê conteúdo do arquivo
 */
async function readFile(filePath) {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (error) {
        console.error(`Erro ao ler ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Verifica se arquivo tem exports
 */
function hasExports(content) {
    return /export\s+(default|const|function|class|let|var)/.test(content);
}

/**
 * Verifica se arquivo tem JSDoc adequado
 */
function hasProperJSDoc(content) {
    // Verifica se tem exports nomeados (não default)
    const hasNamedExports =
        /export\s+(const|function|class|let|var)\s+\w+/.test(content) || /export\s*{\s*\w+/.test(content);

    // Se só tem export default, não precisa de JSDoc específico
    if (!hasNamedExports && /export\s+default/.test(content)) {
        return true;
    }

    // Se não tem exports nomeados, não precisa verificar JSDoc
    if (!hasNamedExports) {
        return true;
    }

    // Para exports nomeados, verificar se cada um tem JSDoc adequado
    const lines = content.split('\n');
    let hasAllJSDoc = true;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Encontrou export nomeado
        if (line.match(/export\s+(const|function|class|let|var)\s+\w+/) || line.match(/export\s*{\s*\w+/)) {
            // Verifica se há JSDoc nas 15 linhas anteriores
            let foundJSDoc = false;
            let jsdocLine = -1;

            // Primeiro, encontra a linha do JSDoc mais próxima
            for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
                const prevLine = lines[j].trim();
                if (
                    prevLine.startsWith('/**') ||
                    prevLine.startsWith(' *') ||
                    prevLine.startsWith(' */') ||
                    prevLine.startsWith('*')
                ) {
                    jsdocLine = j;
                    break;
                }
            }

            // Se encontrou JSDoc, verifica se não há código não-comentário entre JSDoc e export
            if (jsdocLine >= 0) {
                foundJSDoc = true;
                for (let j = jsdocLine + 1; j < i; j++) {
                    const prevLine = lines[j].trim();
                    if (
                        prevLine &&
                        !prevLine.startsWith('//') &&
                        !prevLine.startsWith('/*') &&
                        !prevLine.startsWith('*') &&
                        prevLine !== ''
                    ) {
                        foundJSDoc = false;
                        break;
                    }
                }
            }

            if (!foundJSDoc) {
                hasAllJSDoc = false;
                break;
            }
        }
    }

    return hasAllJSDoc;
}

/**
 * Encontra arquivos .js recursivamente
 */
async function findJSFiles(dirPath) {
    const files = [];

    async function scan(dir) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                    await scan(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.js')) {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Erro ao escanear ${dir}:`, error.message);
        }
    }

    await scan(dirPath);
    return files;
}

/**
 * Processa uma pasta
 */
async function processFolder(folderPath) {
    const fullPath = path.resolve(folderPath);
    console.log(`🔍 Processando: ${folderPath}`);

    const files = await findJSFiles(fullPath);
    const results = {
        total: files.length,
        withExports: 0,
        needsJSDoc: 0,
        hasJSDoc: 0,
        files: [],
    };

    for (const file of files) {
        const content = await readFile(file);
        if (!content) continue;

        const relativePath = path.relative(process.cwd(), file);
        const fileInfo = {
            path: relativePath,
            hasExports: hasExports(content),
            needsJSDoc: false,
            hasProperJSDoc: false,
        };

        if (fileInfo.hasExports) {
            results.withExports++;
            fileInfo.hasProperJSDoc = hasProperJSDoc(content);
            fileInfo.needsJSDoc = !fileInfo.hasProperJSDoc;

            if (fileInfo.needsJSDoc) {
                results.needsJSDoc++;
            } else {
                results.hasJSDoc++;
            }
        }

        results.files.push(fileInfo);
    }

    return results;
}

/**
 * Gera relatório
 */
function generateReport(allResults) {
    console.log('\n' + '='.repeat(80));
    console.log('📊 RELATÓRIO DE COBERTURA JSDOC');
    console.log('='.repeat(80));

    let totalFiles = 0;
    let totalWithExports = 0;
    let totalNeedsJSDoc = 0;
    let totalHasJSDoc = 0;

    for (const [folder, results] of Object.entries(allResults)) {
        console.log(`\n📁 ${folder}`);
        console.log(`   Arquivos: ${results.total}`);
        console.log(`   Com exports: ${results.withExports}`);
        console.log(`   ✅ Com JSDoc: ${results.hasJSDoc}`);
        console.log(`   ❌ Precisa JSDoc: ${results.needsJSDoc}`);

        totalFiles += results.total;
        totalWithExports += results.withExports;
        totalNeedsJSDoc += results.needsJSDoc;
        totalHasJSDoc += results.hasJSDoc;

        if (results.needsJSDoc > 0) {
            console.log('   Arquivos pendentes:');
            results.files.filter(f => f.needsJSDoc).forEach(f => console.log(`     - ${f.path}`));
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📈 RESUMO GERAL');
    console.log('='.repeat(80));
    console.log(`Total de arquivos: ${totalFiles}`);
    console.log(`Com exports: ${totalWithExports}`);
    console.log(`✅ Com JSDoc adequado: ${totalHasJSDoc}`);
    console.log(`❌ Precisa JSDoc: ${totalNeedsJSDoc}`);

    const coverage = totalWithExports > 0 ? ((totalHasJSDoc / totalWithExports) * 100).toFixed(1) : 0;
    console.log(`📊 Cobertura: ${coverage}%`);

    if (totalNeedsJSDoc > 0) {
        console.log('\n🎯 PRÓXIMOS PASSOS:');
        console.log('Execute o script novamente após implementar JSDoc nos arquivos listados.');
    } else {
        console.log('\n🎉 PARABÉNS! Todos os arquivos com exports têm JSDoc adequado.');
    }
}

/**
 * Função principal
 */
async function main() {
    console.log('🚀 Iniciando auditoria de cobertura JSDoc...\n');

    const allResults = {};

    for (const folder of TARGET_FOLDERS) {
        try {
            const results = await processFolder(folder);
            allResults[folder] = results;
        } catch (error) {
            console.error(`Erro ao processar ${folder}:`, error.message);
        }
    }

    generateReport(allResults);

    // Salva relatório em JSON
    const reportPath = path.join(process.cwd(), 'jsdoc-coverage-report.json');
    await fs.writeFile(reportPath, JSON.stringify(allResults, null, 2));
    console.log(`\n💾 Relatório salvo em: ${reportPath}`);
}

// Executa se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { main as auditJSDocCoverage };
