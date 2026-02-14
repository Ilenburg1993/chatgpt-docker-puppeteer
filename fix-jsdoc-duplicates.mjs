import fs from 'fs';

const report = JSON.parse(fs.readFileSync('typescript-diagnostics.json', 'utf8'));

// Filtrar apenas TS1223 (@returns duplicados)
const jsdocErrors = report.errors.filter(e => e.code === 1223 && e.message.includes("'returns' tag already specified"));

console.log(`🔧 Corrigindo ${jsdocErrors.length} @returns duplicados\n`);

// Agrupar por arquivo
const byFile = {};
for (const err of jsdocErrors) {
    if (!err.file) continue;
    if (!byFile[err.file]) byFile[err.file] = [];
    byFile[err.file].push(err);
}

let fixed = 0;
let files = 0;

for (const [file, errors] of Object.entries(byFile)) {
    console.log(`📄 ${file} (${errors.length} duplicações)`);

    let content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    // Marcar linhas para remover (evitar duplicados)
    const toRemove = new Set();

    for (const err of errors) {
        const lineIdx = err.line - 1;
        const line = lines[lineIdx];

        // Se a linha tem @returns, marcar para remoção
        if (line && line.includes('@returns')) {
            // Verificar se há outro @returns próximo
            let foundDuplicate = false;
            for (let i = Math.max(0, lineIdx - 10); i < Math.min(lines.length, lineIdx + 10); i++) {
                if (i !== lineIdx && lines[i] && lines[i].includes('@returns')) {
                    foundDuplicate = true;
                    // Remover a segunda ocorrência (manter a primeira)
                    if (i > lineIdx) {
                        toRemove.add(lineIdx);
                    }
                    break;
                }
            }
            void foundDuplicate; // Indicar que a variável é intencionalmente definida mas pode não ser usada
        }
    }

    if (toRemove.size > 0) {
        const newLines = lines.filter((_, idx) => !toRemove.has(idx));
        fs.writeFileSync(file, newLines.join('\n'));
        fixed += toRemove.size;
        files++;
        console.log(`  ✅ Removidos ${toRemove.size} @returns duplicados\n`);
    } else {
        console.log(`  ⚠️  Nenhuma duplicação clara detectada - revisar manualmente\n`);
    }
}

console.log(`\n✅ Concluído: ${fixed} @returns removidos em ${files} arquivos`);
