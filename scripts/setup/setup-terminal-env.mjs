#!/usr/bin/env node
// @ts-check

/**
 * @fileoverview Configuração visual do ambiente no terminal
 * Define prompts e indicadores visuais para desenvolvimento vs produção
 *
 * @author Sistema de Ambiente
 * @version 1.0.0
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');

/**
 * Detecta o ambiente atual
 * @returns {object} Informações do ambiente
 */
function detectEnvironment() {
    const hasDistBuild = existsSync(join(projectRoot, 'dist/main.js'));
    const isProduction = process.env.NODE_ENV === 'production' && hasDistBuild;
    const cwd = process.cwd();

    return {
        isProduction,
        hasDistBuild,
        cwd,
        isInDist: cwd.includes('/dist') || cwd.endsWith('\\dist'),
    };
}

/**
 * @typedef {object} GeneratePromptConfigEnv
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Gera configuração do prompt do terminal
 * @param {GeneratePromptConfigEnv} env - Informações do ambiente
 * @returns {string} Comando para configurar o prompt
 */
function generatePromptConfig(env) {
    const { isProduction, isInDist } = env;

    if (isProduction || isInDist) {
        // Prompt vermelho para produção
        return `
# 🚨 PRODUÇÃO - CUIDADO! 🚨
export PS1='\\[\\e[1;31m\\][PROD] \\u@\\h:\\w\\$\\[\\e[0m\\] '
export PROMPT_COMMAND='echo -e "\\e[1;31m⚠️  AMBIENTE DE PRODUÇÃO - ALTERAÇÕES PODEM AFETAR USUÁRIOS\\e[0m"'
`;
    } else {
        // Prompt verde para desenvolvimento
        return `
# ✅ DESENVOLVIMENTO - Ambiente Seguro
export PS1='\\[\\e[1;32m\\][DEV] \\u@\\h:\\w\\$\\[\\e[0m\\] '
export PROMPT_COMMAND='echo -e "\\e[1;32m💻 Ambiente de Desenvolvimento\\e[0m"'
`;
    }
}

/**
 * @typedef {object} GenerateAliasesEnv
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Gera aliases úteis baseados no ambiente
 * @param {GenerateAliasesEnv} env - Informações do ambiente
 * @returns {string} Comandos de alias
 */
function generateAliases(env) {
    const { isProduction, isInDist } = env;

    let aliases = `
# Aliases de segurança
alias rm='rm -i'
alias cp='cp -i'
alias mv='mv -i'
`;

    if (isProduction || isInDist) {
        aliases += `
# 🚨 Aliases restritivos para produção
alias npm='echo "🚨 Bloqueado em produção! Use apenas scripts pré-aprovados." && false'
alias node='echo "🚨 Use apenas processos gerenciados pelo PM2 em produção!" && false'
alias git='echo "🚨 Git bloqueado em produção! Faça alterações apenas em desenvolvimento." && false'
`;
    } else {
        aliases += `
# ✅ Aliases de desenvolvimento
alias gs='git status'
alias ga='git add'
alias gc='git commit'
alias gp='git push'
alias dev='npm run dev'
alias build='npm run build'
alias test='npm test'
`;
    }

    return aliases;
}

/**
 * Aplica a configuração do ambiente
 */
function applyEnvironmentConfig() {
    const env = detectEnvironment();

    console.log('🔧 Configurando ambiente do terminal...\n');

    if (env.isProduction || env.isInDist) {
        console.log('🚨 MODO PRODUÇÃO DETECTADO');
        console.log('📍 Localização: Produção/Dist');
        console.log('⚠️  CUIDADO: Alterações podem afetar usuários!');
    } else {
        console.log('✅ MODO DESENVOLVIMENTO DETECTADO');
        console.log('📍 Localização: Desenvolvimento');
        console.log('💻 Ambiente seguro para desenvolvimento');
    }

    console.log('\n📋 Configuração aplicada:');
    console.log(generatePromptConfig(env));
    console.log(generateAliases(env));

    // Para uso em scripts, exporta variáveis
    process.env.CHATGPT_ENV_IS_PRODUCTION = env.isProduction ? '1' : '0';
    process.env.CHATGPT_ENV_HAS_DIST = env.hasDistBuild ? '1' : '0';
    process.env.CHATGPT_ENV_IN_DIST = env.isInDist ? '1' : '0';

    console.log('✅ Configuração do ambiente aplicada com sucesso!');
}

// Executa a configuração
applyEnvironmentConfig();
