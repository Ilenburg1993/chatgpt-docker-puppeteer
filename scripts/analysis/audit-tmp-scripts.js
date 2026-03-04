#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { execSync as _execSync } from 'node:child_process';

const TMP_DIR = '/tmp';
const _SCRIPTS_DIR = path.join(import.meta.dirname);
const AUTO_CLEANUP = process.argv.includes('--auto-cleanup');

// Classification rules based on filename and content patterns
const PATTERNS = {
    SYSTEM: /vscode-remote-containers|\.socket$/,
    TEST_UTIL: /^test_|_test\.js$/,
    CONSTANTS: /constant|literal|scan_|magic/i,
    ANALYSIS: /analyze|scan|audit|check|validate/i,
    DEBUG: /debug|test|fix/i,
};

/**
 * Função exportada: classifyScript.
 * @param {any} filename
 * @param {any} content
 * @returns {any}
 */
function classifyScript(filename, content) {
    // System files - ignore
    if (PATTERNS.SYSTEM.test(filename)) {
        return { category: 'SYSTEM', action: 'IGNORE', reason: 'System/IDE files' };
    }

    // Test utilities - could be useful
    if (PATTERNS.TEST_UTIL.test(filename)) {
        return {
            category: 'DEV_TOOL',
            action: 'EVALUATE',
            reason: 'Test utility - check if redundant with existing test infrastructure',
        };
    }

    // Constants scanning tools
    if (PATTERNS.CONSTANTS.test(filename)) {
        const hasUsefulLogic = content.includes('scanDirectory') || content.includes('fs.readdir');
        if (hasUsefulLogic) {
            return {
                category: 'REUSABLE',
                action: 'MOVE',
                reason: 'General-purpose constant/literal scanning tool',
                target: 'scripts/scan_constants.js',
            };
        } else {
            return {
                category: 'IMMEDIATE',
                action: 'DELETE',
                reason: 'One-time validation script, purpose fulfilled',
            };
        }
    }

    // Analysis tools
    if (PATTERNS.ANALYSIS.test(filename)) {
        const hasReusableLogic = content.length > 1000 && content.includes('function');
        if (hasReusableLogic) {
            return {
                category: 'REUSABLE',
                action: 'MOVE',
                reason: 'Reusable analysis tool',
                target: `scripts/${filename}`,
            };
        } else {
            return {
                category: 'IMMEDIATE',
                action: 'DELETE',
                reason: 'Simple one-off analysis',
            };
        }
    }

    // Debug/fix scripts - usually one-time
    if (PATTERNS.DEBUG.test(filename)) {
        return {
            category: 'IMMEDIATE',
            action: 'DELETE',
            reason: 'Debug/fix script - specific issue already resolved',
        };
    }

    // Unknown - manual review
    return {
        category: 'UNKNOWN',
        action: 'REVIEW',
        reason: 'Requires manual inspection',
    };
}

/**
 * Função exportada: auditTmpScripts.
 * @returns {any}
 */
function auditTmpScripts() {
    console.log('🔍 AUDITING /tmp/ JAVASCRIPT FILES\n');
    console.log('='.repeat(80));

    const files = fs.readdirSync(TMP_DIR).filter(f => f.endsWith('.js'));

    /** @type {Record<string, any[]>} */
    const results = {
        SYSTEM: [],
        IMMEDIATE: [],
        REUSABLE: [],
        DEV_TOOL: [],
        UNKNOWN: [],
    };

    files.forEach(filename => {
        const filepath = path.join(TMP_DIR, filename);
        let content = '';

        try {
            const stat = fs.statSync(filepath);
            if (stat.size > 100000) {
                // Skip very large files (likely system files)
                results.SYSTEM.push({
                    filename,
                    classification: { category: 'SYSTEM', action: 'IGNORE', reason: 'File too large (>100KB)' },
                });
                return;
            }

            content = fs.readFileSync(filepath, 'utf8');
        } catch (err) {
            const _e1 = /** @type {any} */ (err);
            console.error(`⚠️  Cannot read ${filename}: ${_e1.message}`);
            return;
        }

        const classification = classifyScript(filename, content);
        results[classification.category].push({ filename, classification });
    });

    // Print results
    console.log('\n📊 CLASSIFICATION RESULTS:\n');

    Object.keys(results).forEach(category => {
        const items = results[category];
        if (items.length === 0) {
            return;
        }

        const icon = {
            SYSTEM: '🖥️ ',
            IMMEDIATE: '🗑️ ',
            REUSABLE: '♻️ ',
            DEV_TOOL: '🛠️ ',
            UNKNOWN: '❓',
        }[category];

        console.log(`\n${icon} ${category} (${items.length} files):`);
        console.log('-'.repeat(80));

        items.forEach(({ filename, classification }) => {
            console.log(`\n  📄 ${filename}`);
            console.log(`     Action: ${classification.action}`);
            console.log(`     Reason: ${classification.reason}`);
            if (classification.target) {
                console.log(`     Target: ${classification.target}`);
            }
        });
    });

    // Summary and recommendations
    console.log('\n' + '='.repeat(80));
    console.log('\n📋 SUMMARY:\n');

    const toMove = results.REUSABLE.filter(r => r.classification.action === 'MOVE');
    const toDelete = results.IMMEDIATE.filter(r => r.classification.action === 'DELETE');
    const toReview = [...results.DEV_TOOL, ...results.UNKNOWN].filter(r => r.classification.action !== 'IGNORE');

    console.log(`  ♻️  MOVE to scripts/: ${toMove.length} files`);
    console.log(`  🗑️  DELETE (fulfilled): ${toDelete.length} files`);
    console.log(`  👁️  REVIEW manually: ${toReview.length} files`);
    console.log(`  🖥️  IGNORE (system): ${results.SYSTEM.length} files`);

    if (AUTO_CLEANUP) {
        console.log('\n⚡ AUTO-CLEANUP MODE ENABLED\n');
        executeRecommendations(toMove, toDelete);
    } else {
        console.log('\n💡 To execute these recommendations automatically, run:');
        console.log('   node scripts/audit-tmp-scripts.js --auto-cleanup\n');
    }

    return { results, toMove, toDelete, toReview };
}

/**
 * @param {any[]} toMove
 * @param {any[]} toDelete
 */
function executeRecommendations(toMove, toDelete) {
    console.log('='.repeat(80));

    // Move reusable scripts
    if (toMove.length > 0) {
        console.log('\n♻️  MOVING REUSABLE SCRIPTS:\n');
        toMove.forEach(({ filename, classification }) => {
            const source = path.join(TMP_DIR, filename);
            const target = path.join(import.meta.dirname, '..', classification.target);

            try {
                fs.copyFileSync(source, target);
                fs.unlinkSync(source);
                console.log(`  ✅ ${filename} → ${classification.target}`);
            } catch (err) {
                const _e2 = /** @type {any} */ (err);
                console.error(`  ❌ Failed to move ${filename}: ${_e2.message}`);
            }
        });
    }

    // Delete fulfilled scripts
    if (toDelete.length > 0) {
        console.log('\n🗑️  DELETING FULFILLED SCRIPTS:\n');
        toDelete.forEach(({ filename }) => {
            const filepath = path.join(TMP_DIR, filename);
            try {
                fs.unlinkSync(filepath);
                console.log(`  ✅ Deleted ${filename}`);
            } catch (err) {
                const _e3 = /** @type {any} */ (err);
                console.error(`  ❌ Failed to delete ${filename}: ${_e3.message}`);
            }
        });
    }

    console.log('\n✅ Cleanup complete!\n');
}

// Execute
if (import.meta.filename === process.argv[1]) {
    auditTmpScripts();
}

export { auditTmpScripts, classifyScript };
