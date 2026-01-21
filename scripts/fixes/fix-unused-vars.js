#!/usr/bin/env node
/**
 * Unused Variables Auto-Fixer
 *
 * Purpose: Automatically fixes ESLint 'no-unused-vars' errors by prefixing with underscore
 *
 * Fixes:
 * - catch (e) → catch (_e)
 * - function(param) → function(_param)
 * - const varName = ... → const _varName = ...
 * - { destructured } → { destructured: _destructured }
 *
 * Usage:
 *   # Step 1: Generate list of unused vars
 *   npx eslint . --format unix | grep "is defined but never used\|is assigned a value but never used" > /tmp/unused-vars.txt
 *
 *   # Step 2: Fix automatically
 *   node scripts/fixes/fix-unused-vars.js /tmp/unused-vars.txt
 *
 *   # Step 3: Verify fixes
 *   npx eslint . --quiet
 *
 * Exit Codes:
 *   0 - Fixes applied successfully
 *   1 - Input file not found or invalid
 *   2 - Error during processing
 *
 * WARNING: This script modifies files in-place. Commit your changes first!
 *
 * Example input format (ESLint unix output):
 *   /path/file.js:42:10: 'varName' is defined but never used
 */

const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2] || '/tmp/unused-vars.txt';

if (!fs.existsSync(inputFile)) {
    console.error('❌ Input file not found:', inputFile);
    console.error('\nUsage:');
    console.error('  npx eslint . --format unix | grep "is defined but never used" > /tmp/unused-vars.txt');
    console.error('  node scripts/fixes/fix-unused-vars.js /tmp/unused-vars.txt');
    process.exit(1);
}

const content = fs.readFileSync(inputFile, 'utf8');
const unusedVars = content.split('\n').filter(Boolean);

if (unusedVars.length === 0) {
    console.log('✅ No unused variables found!');
    process.exit(0);
}

console.log(`\n🔧 Processing ${unusedVars.length} unused variable(s)...\n`);

const changes = {};

// Parse ESLint output
unusedVars.forEach(line => {
    const match = line.match(
        /^(.*?):(\d+):(\d+):\s+'(.+?)' is (defined but never used|assigned a value but never used)/
    );
    if (!match) {
        return;
    }

    const [, file, lineNum, , varName, type] = match;
    if (!changes[file]) {
        changes[file] = [];
    }
    changes[file].push({ line: parseInt(lineNum), varName, type });
});

let filesModified = 0;
let varsFixed = 0;

// Apply fixes
Object.entries(changes).forEach(([file, vars]) => {
    if (!fs.existsSync(file)) {
        console.error(`⚠️  File not found: ${file}`);
        return;
    }

    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let modified = false;

    vars.forEach(({ line, varName }) => {
        const lineIdx = line - 1;
        if (lineIdx >= lines.length) {
            return;
        }

        const lineContent = lines[lineIdx];
        let newLine = lineContent;

        // Fix pattern 1: catch(e) -> catch(_e)
        if (lineContent.includes(`catch (${varName})`)) {
            newLine = lineContent.replace(`catch (${varName})`, `catch (_${varName})`);
        }
        // Fix pattern 2: function parameters
        else if (lineContent.match(new RegExp(`function\\s+\\w+\\s*\\([^)]*\\b${varName}\\b`))) {
            newLine = lineContent.replace(new RegExp(`\\b${varName}\\b(?=[,)])`), `_${varName}`);
        }
        // Fix pattern 3: arrow function parameters
        else if (lineContent.match(new RegExp(`\\([^)]*\\b${varName}\\b[^)]*\\)\\s*=>`))) {
            newLine = lineContent.replace(new RegExp(`\\b${varName}\\b(?=[,)])`), `_${varName}`);
        }
        // Fix pattern 4: variable declarations
        else if (lineContent.match(new RegExp(`\\b(const|let|var)\\s+${varName}\\b`))) {
            newLine = lineContent.replace(new RegExp(`\\b(const|let|var)\\s+${varName}\\b`), `$1 _${varName}`);
        }
        // Fix pattern 5: destructuring
        else if (lineContent.match(new RegExp(`\\{[^}]*\\b${varName}\\b[^}]*\\}`))) {
            newLine = lineContent.replace(new RegExp(`\\b${varName}\\b(?=[,}])`), `${varName}: _${varName}`);
        }

        if (newLine !== lineContent) {
            lines[lineIdx] = newLine;
            modified = true;
            varsFixed++;
            console.log(`  ✓ ${path.basename(file)}:${line} - ${varName} → _${varName}`);
        }
    });

    if (modified) {
        fs.writeFileSync(file, lines.join('\n'), 'utf8');
        filesModified++;
    }
});

console.log(`\n✅ Fixed ${varsFixed} variable(s) in ${filesModified} file(s)\n`);
console.log('💡 Run ESLint again to verify fixes:');
console.log('   npx eslint . --quiet\n');

process.exit(0);
