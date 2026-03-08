import fs from 'fs';
import path from 'path';

// Função simples para listar arquivos recursivamente
function findFiles(dir) {
    const results = [];

    function walk(currentDir) {
        try {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.js')) {
                    results.push(fullPath);
                }
            }
        } catch (e) {
            // Ignorar erros de permissão ou diretórios inacessíveis
            void e;
        }
    }

    walk(dir);
    return results;
}

// Arquivos CORE que devem ter type checking rigoroso
const coreDirs = ['src/core', 'src/kernel', 'src/orchestrator', 'src/logic'];

const coreFiles = [
    'src/driver/core/BaseDriver.js',
    'src/driver/core/TargetDriver.js',
    'src/driver/factory.js',
    'src/infra/ConnectionOrchestrator.js',
    'src/main.js',
];

const files = [...coreDirs.flatMap((dir) => findFiles(dir)), ...coreFiles.filter((f) => fs.existsSync(f))];

console.log(`🔧 Habilitando // @ts-check em ${files.length} arquivos CORE\n`);

let added = 0;

for (const file of files) {
    try {
        const content = fs.readFileSync(file, 'utf8');

        // Skip se já tem @ts-check ou @ts-nocheck
        if (content.includes('@ts-check') || content.includes('@ts-nocheck')) {
            continue;
        }

        const lines = content.split('\n');
        let insertIdx = 0;

        // Skip shebang
        if (lines[0] && lines[0].startsWith('#!')) insertIdx = 1;

        // Inserir @ts-check logo no início (após shebang)
        lines.splice(insertIdx, 0, '// @ts-check - Type checking rigoroso habilitado (arquivo core)');

        fs.writeFileSync(file, lines.join('\n'));
        added++;

        if (added <= 15) {
            console.log(`✅ ${file}`);
        }
    } catch (err) {
        console.error(`❌ ${file}: ${err.message}`);
    }
}

if (added > 15) {
    console.log(`... e mais ${added - 15} arquivos`);
}

console.log(`\n✅ Type checking habilitado em ${added} arquivos core`);
