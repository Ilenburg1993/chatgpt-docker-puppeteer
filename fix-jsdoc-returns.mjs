import fs from 'fs';

/** @typedef {{ code: number; file?: string; line: number }} DiagnosticEntry */
/** @type {{ errors: DiagnosticEntry[] }} */
const report = JSON.parse(fs.readFileSync('typescript-diagnostics.json', 'utf8'));

// Filtrar apenas TS1223
const jsdocErrors = report.errors.filter((e) => e.code === 1223);

// Agrupar por arquivo
/** @type {Record<string, DiagnosticEntry[]>} */
const byFile = {};
for (const err of jsdocErrors) {
    if (!err.file) continue;
    const errors = byFile[err.file] ?? (byFile[err.file] = []);
    errors.push(err);
}

console.log(`🔧 Corrigindo @returns duplicados em ${Object.keys(byFile).length} arquivos\n`);

let totalFixed = 0;

for (const [file, errors] of Object.entries(byFile)) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    // Agrupar erros consecutivos (mesmo bloco JSDoc)
    const firstError = errors[0];
    if (!firstError) continue;
    /** @type {DiagnosticEntry[][]} */
    const blocks = [];
    let currentBlock = [firstError];

    for (let i = 1; i < errors.length; i++) {
        const error = errors[i];
        const previousError = errors[i - 1];
        if (!error || !previousError) continue;
        if (error.line - previousError.line === 1) {
            currentBlock.push(error);
        } else {
            blocks.push(currentBlock);
            currentBlock = [error];
        }
    }
    blocks.push(currentBlock);

    // Processar cada bloco (de trás pra frente para não afetar índices)
    for (const block of blocks.reverse()) {
        const firstBlockError = block[0];
        const lastBlockError = block[block.length - 1];
        if (!firstBlockError || !lastBlockError) continue;
        const startLine = firstBlockError.line - 1;
        const endLine = lastBlockError.line - 1;

        // Encontrar início do bloco JSDoc
        let jsdocStart = startLine;
        while (jsdocStart > 0 && !lines[jsdocStart]?.trim().startsWith('/**')) {
            jsdocStart--;
        }

        // Coletar propriedades
        const properties = [];
        for (let i = startLine; i <= endLine; i++) {
            const line = lines[i];
            const match = line?.match(/@returns\s+\{([^}]+)\}\s+return\.(\w+)\s+-\s+(.*)/);
            if (match) {
                const [, type, name, desc] = match;
                if (!type || !name || !desc) continue;
                properties.push({
                    type,
                    name,
                    desc,
                });
            }
        }

        if (properties.length > 0) {
            // Remover linhas de @returns das propriedades
            lines.splice(startLine, endLine - startLine + 1);

            // Inserir propriedades como comentário descritivo
            const propDescLines = properties.map((p) => `     *   - ${p.name} (${p.type}): ${p.desc}`);
            lines.splice(startLine, 0, `     * Propriedades do objeto retornado:`, ...propDescLines);

            totalFixed++;
        }
    }

    fs.writeFileSync(file, lines.join('\n'));
    console.log(`✅ ${file}: ${blocks.length} bloco(s) corrigido(s)`);
}

console.log(`\n🎉 Total: ${totalFixed} blocos JSDoc corrigidos`);
