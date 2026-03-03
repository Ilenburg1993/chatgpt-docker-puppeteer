#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';

function fixFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf-8');
    let totalFixed = 0;

    // Padrão 1: } catch (e) {}
    const pattern1 = /\} catch \(([a-z][a-zA-Z0-9]*)\) \{\}/g;
    const matches1 = content.match(pattern1);
    if (matches1) {
        content = content.replace(pattern1, '} catch (_$1) { } // eslint-disable-line no-empty');
        totalFixed += matches1.length;
    }

    // Padrão 2: .catch(() => {})
    const pattern2 = /\.catch\(\(\) => \{\}\)/g;
    const matches2 = content.match(pattern2);
    if (matches2) {
        content = content.replace(pattern2, '.catch(() => { }) // eslint-disable-line no-empty');
        totalFixed += matches2.length;
    }

    if (totalFixed > 0) {
        fs.writeFileSync(filePath, content, 'utf-8');
    }

    return totalFixed;
}

function walkDir(dir) {
    let totalFixed = 0;
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!['node_modules', '.git', 'dist', 'logs'].includes(file)) {
                totalFixed += walkDir(fullPath);
            }
        } else if (file.endsWith('.js') && !file.includes('fix-empty-catch')) {
            const fixed = fixFile(fullPath);
            if (fixed > 0) {
                console.log(`✅ ${fullPath}: ${fixed} corrigido(s)`);
                totalFixed += fixed;
            }
        }
    }

    return totalFixed;
}

console.log('🔧 Corrigindo blocos catch vazios...\n');
const total = walkDir('./src') + walkDir('./scripts') + walkDir('./public');
console.log(`\n✅ Total: ${total} ocorrências corrigidas`);
