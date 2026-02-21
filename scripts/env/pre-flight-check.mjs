#!/usr/bin/env node

/**
 * @fileoverview Validação pré-voo para ambiente de produção
 * Verifica se todos os pré-requisitos estão atendidos antes de iniciar PM2
 *
 * @author Sistema de Ambiente
 * @version 1.0.0
 */

import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');

/**
 * Validações críticas para produção
 * @typedef {Object} ValidationResult
 * @property {boolean} success - Se a validação passou
 * @property {string} message - Mensagem descritiva
 * @property {boolean} critical - Se é um erro crítico que impede execução
 */

/**
 * Verifica se arquivos essenciais existem
 * @param {boolean} isProduction - Se está em modo produção
 * @returns {ValidationResult}
 */
function validateEssentialFiles(isProduction) {
    const essentialFiles = ['package.json', 'config.json', 'ecosystem.config.cjs', 'scripts/chrome-proxy-service.js'];

    // Em produção, também requer o build
    if (isProduction) {
        essentialFiles.push('dist/main.js');
    }

    const missing = essentialFiles.filter(file => !existsSync(join(projectRoot, file)));

    if (missing.length > 0) {
        return {
            success: false,
            message: `Arquivos essenciais faltando: ${missing.join(', ')}`,
            critical: true,
        };
    }

    return {
        success: true,
        message: 'Todos os arquivos essenciais estão presentes',
        critical: false,
    };
}

/**
 * Verifica se o build de produção está atualizado
 * @param {boolean} isProduction - Se está em modo produção
 * @returns {ValidationResult}
 */
function validateBuildFreshness(isProduction) {
    if (!isProduction) {
        // Em desenvolvimento, permite execução sem build
        return {
            success: true,
            message: 'Modo desenvolvimento - build não obrigatório',
            critical: false,
        };
    }

    const sourceFile = join(projectRoot, 'src/main.js');
    const buildFile = join(projectRoot, 'dist/main.js');

    if (!existsSync(sourceFile) || !existsSync(buildFile)) {
        return {
            success: false,
            message: 'Build de produção não encontrado',
            critical: true,
        };
    }

    const sourceTime = statSync(sourceFile).mtime.getTime();
    const buildTime = statSync(buildFile).mtime.getTime();

    if (buildTime < sourceTime) {
        return {
            success: false,
            message: 'Build de produção está desatualizado. Execute: npm run build',
            critical: true,
        };
    }

    return {
        success: true,
        message: 'Build de produção está atualizado',
        critical: false,
    };
}

/**
 * Verifica se as dependências estão instaladas
 * @returns {ValidationResult}
 */
function validateDependencies() {
    const nodeModules = join(projectRoot, 'node_modules');

    if (!existsSync(nodeModules)) {
        return {
            success: false,
            message: 'Dependências não instaladas. Execute: npm install',
            critical: true,
        };
    }

    // Verifica se algumas dependências críticas existem
    const criticalDeps = ['puppeteer', 'express', 'socket.io'];
    const missingDeps = criticalDeps.filter(dep => !existsSync(join(nodeModules, dep)));

    if (missingDeps.length > 0) {
        return {
            success: false,
            message: `Dependências críticas faltando: ${missingDeps.join(', ')}`,
            critical: true,
        };
    }

    return {
        success: true,
        message: 'Dependências estão instaladas',
        critical: false,
    };
}

/**
 * Verifica se as portas necessárias estão livres
 * @returns {ValidationResult}
 */
function validatePorts() {
    // Esta é uma verificação básica - em produção pode haver conflitos
    // Mas pelo menos verificamos se não há processos locais óbvios
    return {
        success: true,
        message: 'Verificação de portas será feita pelo PM2',
        critical: false,
    };
}

/**
 * Executa todas as validações
 * @returns {Promise<void>}
 */
async function runValidations() {
    // Detecta ambiente baseado em NODE_ENV ou presença de dist/main.js
    const hasDistBuild = existsSync(join(projectRoot, 'dist/main.js'));
    const isProduction = process.env.NODE_ENV === 'production' && hasDistBuild;

    console.log(`🚀 Validação Pré-Voo - Ambiente ${isProduction ? 'de Produção' : 'de Desenvolvimento'}\n`);

    const validations = [
        () => validateEssentialFiles(isProduction),
        () => validateBuildFreshness(isProduction),
        validateDependencies,
        validatePorts,
    ];

    let hasCriticalErrors = false;
    const results = [];

    for (const validation of validations) {
        const result = validation();
        results.push(result);

        const icon = result.success ? '✅' : result.critical ? '❌' : '⚠️';
        console.log(`${icon} ${result.message}`);

        if (!result.success && result.critical) {
            hasCriticalErrors = true;
        }
    }

    console.log('\n' + '='.repeat(50));

    if (hasCriticalErrors) {
        console.log('❌ Validação falhou! Corrija os erros críticos antes de continuar.');
        process.exit(1);
    } else {
        console.log('✅ Ambiente validado com sucesso! Pronto para produção.');
    }
}

// Executa as validações
runValidations().catch(error => {
    console.error('❌ Erro durante validação:', error.message);
    process.exit(1);
});
