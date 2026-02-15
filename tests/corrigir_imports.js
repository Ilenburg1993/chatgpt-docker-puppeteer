#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// Mapeamento: padrão antigo -> quantos níveis subir
const correcoes = {
    'tests/unit/core': '../../../',
    'tests/unit/infra': '../../../',
    'tests/unit/driver': '../../../',
    'tests/unit/kernel': '../../../',
    'tests/unit/nerv': '../../../',
    'tests/unit/server': '../../../',
    'tests/unit/state': '../../../',
    'tests/unit/logic': '../../../',
    'tests/integration/kernel': '../../../',
    'tests/integration/driver': '../../../',
    'tests/integration/api': '../../../',
    'tests/integration/queue': '../../../',
    'tests/integration/browser': '../../../',
    'tests/e2e': '../../',
    'tests/regression': '../../',
    'tests/manual': '../../',
    'tests/helpers': '../../'
};

function corrigirArquivo(caminhoArquivo) {
    const conteudo = fs.readFileSync(caminhoArquivo, 'utf-8');
    let alterado = false;

    // Detectar diretório relativo ao projeto
    const dirRelativo = path.dirname(path.relative(import.meta.dirname, caminhoArquivo));
    const prefixo = correcoes[dirRelativo];

    if (!prefixo) {
        console.log(`⚠️  Sem correção para: ${dirRelativo}`);
        return;
    }

    // Padrões a corrigir
    const padroes = [
        { de: /require\(['"]\.\.\/src\//g, para: `require('${prefixo}src/` },
        { de: /require\(['"]\.\.\/config\.json/g, para: `require('${prefixo}config.json` },
        { de: /require\(['"]\.\.\/dynamic_rules\.json/g, para: `require('${prefixo}dynamic_rules.json` },
        { de: /require\(['"]\.\.\/package\.json/g, para: `require('${prefixo}package.json` },
        { de: /\.\.\/\.gitignore/g, para: `${prefixo}.gitignore` },
        { de: /\.\.\/config\.json/g, para: `${prefixo}config.json` },
        { de: /\.\.\/dynamic_rules\.json/g, para: `${prefixo}dynamic_rules.json` }
    ];

    let novoConteudo = conteudo;
    for (const { de, para } of padroes) {
        if (de.test(novoConteudo)) {
            novoConteudo = novoConteudo.replace(de, para);
            alterado = true;
        }
    }

    if (alterado) {
        fs.writeFileSync(caminhoArquivo, novoConteudo, 'utf-8');
        console.log(`✓ Corrigido: ${caminhoArquivo}`);
        return true;
    }

    return false;
}

// Processar todos os arquivos .spec.js
function corrigirTodos() {
    console.log('🔧 Corrigindo imports relativos nos testes...\n');

    let totalCorrigidos = 0;

    for (const dir of Object.keys(correcoes)) {
        const caminhoDiretorio = path.join(import.meta.dirname, dir);
        if (!fs.existsSync(caminhoDiretorio)) {
            continue;
        }

        const arquivos = fs.readdirSync(caminhoDiretorio);
        for (const arquivo of arquivos) {
            if (arquivo.endsWith('.spec.js') || arquivo.endsWith('.js')) {
                const caminhoCompleto = path.join(caminhoDiretorio, arquivo);
                if (corrigirArquivo(caminhoCompleto)) {
                    totalCorrigidos++;
                }
            }
        }
    }

    console.log(`\n✅ Total corrigido: ${totalCorrigidos} arquivo(s)`);
}

corrigirTodos();
