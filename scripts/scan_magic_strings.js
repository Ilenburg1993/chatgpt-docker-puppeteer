#!/usr/bin/env node
/**
 * Magic Strings Scanner
 *
 * Purpose: Deep scan for hardcoded strings that should be constants
 *
 * Detects 11 different patterns:
 * 1. actor: 'STRING' assignments
 * 2. messageType: 'STRING' assignments
 * 3. actionCode: 'STRING' assignments
 * 4. kind: 'STRING' assignments
 * 5. envelope.actor === 'STRING' comparisons
 * 6. envelope.messageType === 'STRING' comparisons
 * 7. envelope.kind === 'STRING' comparisons
 * 8. actionCode === 'STRING' comparisons
 * 9. case 'ACTIONCODE': switch statements
 * 10. { actor: 'STRING' } object literals
 * 11. source/target: 'role' in headers
 *
 * Usage:
 *   node scripts/scan_magic_strings.js                    # Scan src/ only
 *   node scripts/scan_magic_strings.js --include-tests    # Include tests/
 *   node scripts/scan_magic_strings.js --directory path/  # Custom directory
 *
 * Exit Codes:
 *   0 - No magic strings found (success)
 *   1 - Magic strings found in src/
 *   2 - Error during execution
 */

const fs = require('fs');
const path = require('path');

// Parse arguments
const args = process.argv.slice(2);
const INCLUDE_TESTS = args.includes('--include-tests');
const CUSTOM_DIR = args.find(arg => arg.startsWith('--directory='))?.split('=')[1];

const ROOT = CUSTOM_DIR || '/workspaces/chatgpt-docker-puppeteer';
const DEFAULT_EXCLUDES = ['node_modules', 'backups', '.git', 'logs', 'coverage', 'profile'];

// Comprehensive pattern definitions
const PATTERNS = [
    // NERV Protocol - Property assignments
    {
        name: "actor: 'STRING'",
        regex: /actor:\s*['"](?!ActorRole\.|this\.)(KERNEL|SERVER|INFRA|OBSERVER|MAESTRO|DRIVER)['"]/gi,
        severity: 'HIGH',
        fix: 'Use ActorRole.CONSTANT'
    },
    {
        name: "messageType: 'STRING'",
        regex: /messageType:\s*['"](?!MessageType\.)(COMMAND|EVENT|ACK)['"]/gi,
        severity: 'HIGH',
        fix: 'Use MessageType.CONSTANT'
    },
    {
        name: "actionCode: 'STRING'",
        regex: /actionCode:\s*['"](?!ActionCode\.)([A-Z_]{3,})['"]/g,
        severity: 'HIGH',
        fix: 'Use ActionCode.CONSTANT'
    },
    {
        name: "kind: 'STRING'",
        regex: /kind:\s*['"](?!MessageType\.)(COMMAND|EVENT|ACK)['"]/gi,
        severity: 'HIGH',
        fix: 'Use MessageType.CONSTANT (kind is alias for messageType)'
    },

    // NERV Protocol - Comparisons
    {
        name: "envelope.actor === 'STRING'",
        regex: /\.actor\s*===?\s*['"](?!ActorRole\.)(KERNEL|SERVER|INFRA|DRIVER)['"]/gi,
        severity: 'MEDIUM',
        fix: 'Use ActorRole.CONSTANT in comparison'
    },
    {
        name: "envelope.messageType === 'STRING'",
        regex: /\.messageType\s*===?\s*['"](?!MessageType\.)(COMMAND|EVENT|ACK)['"]/gi,
        severity: 'MEDIUM',
        fix: 'Use MessageType.CONSTANT in comparison'
    },
    {
        name: "envelope.kind === 'STRING'",
        regex: /\.kind\s*===?\s*['"](?!MessageType\.)(COMMAND|EVENT|ACK)['"]/gi,
        severity: 'MEDIUM',
        fix: 'Use MessageType.CONSTANT in comparison'
    },
    {
        name: "actionCode === 'STRING'",
        regex: /actionCode\s*===?\s*['"](?!ActionCode\.)([A-Z_]{3,})['"]/g,
        severity: 'MEDIUM',
        fix: 'Use ActionCode.CONSTANT in comparison'
    },

    // Switch statements
    {
        name: "case 'ACTIONCODE':",
        regex: /case\s+['"](?!ActionCode\.)([A-Z_]{3,})['"]\s*:/g,
        severity: 'MEDIUM',
        fix: 'Use case ActionCode.CONSTANT:'
    },

    // Object literals (envelope creation)
    {
        name: "{ actor: 'STRING' }",
        regex: /{\s*actor:\s*['"](?!ActorRole\.)(KERNEL|SERVER|INFRA)['"]/gi,
        severity: 'HIGH',
        fix: 'Use ActorRole.CONSTANT in object creation'
    },

    // Headers (source/target)
    {
        name: "source/target: 'role'",
        regex: /(source|target):\s*['"](?!ActorRole\.|this\.)(kernel|server|driver|infra)['"]/gi,
        severity: 'LOW',
        fix: 'Consider using ActorRole.CONSTANT.toLowerCase() if cross-subsystem'
    }
];

/**
 * Scan a single file for magic string patterns
 */
function scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const results = [];

    PATTERNS.forEach(pattern => {
        const matches = [...content.matchAll(pattern.regex)];
        if (matches.length > 0) {
            matches.forEach(match => {
                const lines = content.substring(0, match.index).split('\n');
                const lineNum = lines.length;
                const lineContent = lines[lineNum - 1].trim();

                results.push({
                    pattern: pattern.name,
                    severity: pattern.severity,
                    fix: pattern.fix,
                    match: match[0],
                    line: lineNum,
                    lineContent: lineContent,
                    file: filePath
                });
            });
        }
    });

    return results;
}

/**
 * Recursively scan directory for JS files
 */
function scanDirectory(dir, results = [], excludeDirs = DEFAULT_EXCLUDES) {
    const items = fs.readdirSync(dir);

    items.forEach(item => {
        if (item.startsWith('.')) {
            return;
        }

        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory() && !excludeDirs.includes(item)) {
            scanDirectory(fullPath, results, excludeDirs);
        } else if (stat.isFile() && item.endsWith('.js') && !item.includes('.min.')) {
            const fileResults = scanFile(fullPath);
            results.push(...fileResults);
        }
    });

    return results;
}

/**
 * Print results grouped by file
 */
function printResults(results, label) {
    if (results.length === 0) {
        console.log(`\n✅ ${label}: CLEAN - No magic strings found!\n`);
        return;
    }

    console.log(`\n⚠️  ${label}: FOUND ${results.length} OCCURRENCE(S):\n`);

    // Group by file
    const byFile = {};
    results.forEach(r => {
        const shortPath = r.file.replace(ROOT + '/', '');
        if (!byFile[shortPath]) {
            byFile[shortPath] = [];
        }
        byFile[shortPath].push(r);
    });

    // Group by severity
    const bySeverity = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    results.forEach(r => bySeverity[r.severity]++);

    console.log('📊 SEVERITY BREAKDOWN:');
    console.log(`   🔴 HIGH: ${bySeverity.HIGH} (must fix)`);
    console.log(`   🟡 MEDIUM: ${bySeverity.MEDIUM} (should fix)`);
    console.log(`   🔵 LOW: ${bySeverity.LOW} (consider fixing)\n`);

    // Print details
    Object.keys(byFile)
        .sort()
        .forEach(file => {
            const issues = byFile[file];
            const severityIcon = {
                HIGH: '🔴',
                MEDIUM: '🟡',
                LOW: '🔵'
            };

            console.log(`\n📄 ${file} (${issues.length} issue${issues.length > 1 ? 's' : ''}):`);
            issues.forEach(r => {
                console.log(`   ${severityIcon[r.severity]} Line ${r.line}: ${r.pattern}`);
                console.log(`      Match: ${r.match}`);
                console.log(`      Fix: ${r.fix}`);
                console.log(`      Code: ${r.lineContent.substring(0, 80)}${r.lineContent.length > 80 ? '...' : ''}`);
            });
        });
}

/**
 * Main execution
 */
function main() {
    console.log('🔍 MAGIC STRINGS SCANNER\n');
    console.log('='.repeat(80));
    console.log(`\n📁 Scanning: ${ROOT}/src/`);
    if (INCLUDE_TESTS) {
        console.log(`📁 Including: ${ROOT}/tests/`);
    }
    console.log('');

    // Scan src/
    const srcResults = scanDirectory(path.join(ROOT, 'src'));
    printResults(srcResults, 'SRC DIRECTORY');

    // Optionally scan tests/
    if (INCLUDE_TESTS) {
        console.log('\n' + '='.repeat(80));
        const testResults = scanDirectory(path.join(ROOT, 'tests'));

        if (testResults.length === 0) {
            console.log('\n✅ TESTS: Clean!\n');
        } else {
            console.log(`\nℹ️  TESTS: ${testResults.length} occurrence(s)`);
            console.log('(Note: Tests may legitimately use string literals for validation)\n');

            const byFile = {};
            testResults.forEach(r => {
                const shortPath = r.file.replace(ROOT + '/', '');
                if (!byFile[shortPath]) {
                    byFile[shortPath] = [];
                }
                byFile[shortPath].push(r);
            });

            Object.keys(byFile)
                .sort()
                .forEach(file => {
                    console.log(`  ${file}: ${byFile[file].length} occurrence(s)`);
                });
        }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('\n📋 FINAL VERDICT:\n');

    if (srcResults.length === 0) {
        console.log('🎉 SUCCESS: No magic strings in production code!\n');
        console.log('All NERV protocol values use typed constants.\n');
        return 0;
    } else {
        console.log(`❌ ACTION REQUIRED: ${srcResults.length} magic string(s) found in src/\n`);
        console.log('Please replace hardcoded strings with constants from:');
        console.log('  - src/shared/nerv/constants.js (ActorRole, MessageType, ActionCode)\n');
        return 1;
    }
}

// Execute
if (require.main === module) {
    try {
        const exitCode = main();
        process.exit(exitCode);
    } catch (err) {
        console.error('\n❌ ERROR:', err.message);
        console.error(err.stack);
        process.exit(2);
    }
}

module.exports = { scanFile, scanDirectory, PATTERNS };
