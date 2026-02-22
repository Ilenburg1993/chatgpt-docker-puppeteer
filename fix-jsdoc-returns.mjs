import fs from 'fs';

const report = JSON.parse(fs.readFileSync('typescript-diagnostics.json', 'utf8'));

// Filtrar apenas TS1223
const jsdocErrors = report.errors.filter(e => e.code === 1223);

// Agrupar por arquivo
const byFile = {};
for (const err of jsdocErrors) {
    if (!err.file) continue;
    if (!byFile[err.file]) byFile[err.file] = [];
    byFile[err.file].push(err);
}

console.log(`🔧 Corrigindo @returns duplicados em ${Object.keys(byFile).length} arquivos\n`);

let totalFixed = 0;

for (const [file, errors] of Object.entries(byFile)) {
    let content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    // Agrupar erros consecutivos (mesmo bloco JSDoc)
    const blocks = [];
    let currentBlock = [errors[0]];

    for (let i = 1; i < errors.length; i++) {
        if (errors[i].line - errors[i - 1].line === 1) {
            currentBlock.push(errors[i]);
        } else {
            blocks.push(currentBlock);
            currentBlock = [errors[i]];
        }
    }
    blocks.push(currentBlock);

    // Processar cada bloco (de trás pra frente para não afetar índices)
    for (const block of blocks.reverse()) {
        const startLine = block[0].line - 1;
        const endLine = block[block.length - 1].line - 1;

        // Encontrar início do bloco JSDoc
        let jsdocStart = startLine;
        while (jsdocStart > 0 && !lines[jsdocStart].trim().startsWith('/**')) {
            jsdocStart--;
        }

        // Coletar propriedades
        const properties = [];
        for (let i = startLine; i <= endLine; i++) {
            const line = lines[i];
            const match = line.match(/@returns\s+\{([^}]+)\}\s+return\.(\w+)\s+-\s+(.*)/);
            if (match) {
                properties.push({
                    type: match[1],
                    name: match[2],
                    desc: match[3],
                });
            }
        }

        if (properties.length > 0) {
            // Remover linhas de @returns das propriedades
            lines.splice(startLine, endLine - startLine + 1);

            // Inserir propriedades como comentário descritivo
            const propDescLines = properties.map(p => `     *   - ${p.name} (${p.type}): ${p.desc}`);
            lines.splice(startLine, 0, `     * Propriedades do objeto retornado:`, ...propDescLines);

            totalFixed++;
        }
    }

    fs.writeFileSync(file, lines.join('\n'));
    console.log(`✅ ${file}: ${blocks.length} bloco(s) corrigido(s)`);
}

console.log(`\n🎉 Total: ${totalFixed} blocos JSDoc corrigidos`);
