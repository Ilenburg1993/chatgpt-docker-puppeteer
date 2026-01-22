#!/usr/bin/env node
/**
 * Auto-Fix ESLint Errors Script
 * Version: 1.0
 * Date: 2026-01-22
 *
 * Fixes common ESLint errors automatically:
 * - no-promise-executor-return (11 occurrences)
 * - no-proto (4 occurrences)
 * - no-control-regex (2 occurrences)
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. Fix no-promise-executor-return (wrap return in void)
// ============================================================================
const promiseExecutorFixes = [
    {
        file: 'src/kernel/kernel_loop/kernel_loop.js',
        line: 323,
        pattern: /return setTimeout\(resolve, delay\);/,
        replacement: 'setTimeout(resolve, delay);'
    },
    {
        file: 'tests/unit/core/test_logger.spec.js',
        line: 139,
        pattern: /return setTimeout\(resolve, 100\);/,
        replacement: 'setTimeout(resolve, 100);'
    },
    {
        file: 'tests/unit/driver/test_driver_adapters.spec.js',
        line: 39,
        pattern: /return setTimeout\(resolve, 10\);/,
        replacement: 'setTimeout(resolve, 10);'
    },
    {
        file: 'tests/unit/driver/test_driver_adapters.spec.js',
        line: 153,
        pattern: /return setTimeout\(resolve, 10\);/,
        replacement: 'setTimeout(resolve, 10);'
    },
    {
        file: 'tests/unit/driver/test_driver_adapters.spec.js',
        line: 262,
        pattern: /return setTimeout\(resolve, 10\);/,
        replacement: 'setTimeout(resolve, 10);'
    },
    {
        file: 'tests/unit/driver/test_driver_adapters.spec.js',
        line: 274,
        pattern: /return setTimeout\(resolve, 10\);/,
        replacement: 'setTimeout(resolve, 10);'
    },
    {
        file: 'tests/unit/nerv/test_nerv_core.spec.js',
        line: 121,
        pattern: /return setTimeout\(resolve, 10\);/,
        replacement: 'setTimeout(resolve, 10);'
    },
    {
        file: 'tests/unit/nerv/test_nerv_core.spec.js',
        line: 143,
        pattern: /return setTimeout\(resolve, 10\);/,
        replacement: 'setTimeout(resolve, 10);'
    },
    {
        file: 'tests/unit/nerv/test_nerv_core.spec.js',
        line: 186,
        pattern: /return setTimeout\(resolve, 10\);/,
        replacement: 'setTimeout(resolve, 10);'
    },
    {
        file: 'tests/unit/nerv/test_nerv_core.spec.js',
        line: 245,
        pattern: /return setTimeout\(resolve, 10\);/,
        replacement: 'setTimeout(resolve, 10);'
    },
    {
        file: 'tests/unit/server/test_server_nerv_adapter.spec.js',
        line: 270,
        pattern: /return setTimeout\(resolve, 10\);/,
        replacement: 'setTimeout(resolve, 10);'
    }
];

// ============================================================================
// 2. Fix no-proto (__proto__ → Object.setPrototypeOf)
// ============================================================================
const protoFixes = [
    {
        file: 'tests/unit/server/test_middleware.spec.js',
        line: 219,
        pattern: /req\.__proto__ = Object\.create\(http\.IncomingMessage\.prototype\);/,
        replacement: 'Object.setPrototypeOf(req, Object.create(http.IncomingMessage.prototype));'
    },
    {
        file: 'tests/unit/server/test_server_nerv_adapter.spec.js',
        line: 241,
        pattern: /req\.__proto__ = Object\.create\(http\.IncomingMessage\.prototype\);/,
        replacement: 'Object.setPrototypeOf(req, Object.create(http.IncomingMessage.prototype));'
    }
];

// ============================================================================
// 3. Fix no-control-regex (add eslint-disable comment)
// ============================================================================
const controlRegexFixes = [
    {
        file: 'src/driver/modules/human.js',
        line: 157,
        addComment: '// eslint-disable-next-line no-control-regex'
    },
    {
        file: 'tests/unit/driver/test_driver_adapters.spec.js',
        line: 111,
        addComment: '// eslint-disable-next-line no-control-regex'
    }
];

// ============================================================================
// Helper Functions
// ============================================================================
function applyFix(filePath, pattern, replacement) {
    try {
        const fullPath = path.join(process.cwd(), filePath);
        let content = fs.readFileSync(fullPath, 'utf8');

        if (pattern instanceof RegExp) {
            if (!pattern.test(content)) {
                console.log(`⚠️  Pattern not found in ${filePath}`);
                return false;
            }
            content = content.replace(pattern, replacement);
        } else {
            if (!content.includes(pattern)) {
                console.log(`⚠️  Pattern not found in ${filePath}`);
                return false;
            }
            content = content.replace(pattern, replacement);
        }

        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`✅ Fixed: ${filePath}`);
        return true;
    } catch (e) {
        console.log(`❌ Error fixing ${filePath}: ${e.message}`);
        return false;
    }
}

function addCommentBeforeLine(filePath, lineNumber, comment) {
    try {
        const fullPath = path.join(process.cwd(), filePath);
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');

        if (lineNumber > lines.length) {
            console.log(`⚠️  Line ${lineNumber} not found in ${filePath}`);
            return false;
        }

        const targetLine = lines[lineNumber - 1];
        const indent = targetLine.match(/^(\s*)/)[1];

        // Check if comment already exists
        if (lines[lineNumber - 2] && lines[lineNumber - 2].includes('eslint-disable')) {
            console.log(`⏭️  Already has eslint-disable: ${filePath}:${lineNumber}`);
            return false;
        }

        lines.splice(lineNumber - 1, 0, indent + comment);

        fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
        console.log(`✅ Added comment: ${filePath}:${lineNumber}`);
        return true;
    } catch (e) {
        console.log(`❌ Error adding comment to ${filePath}: ${e.message}`);
        return false;
    }
}

// ============================================================================
// Main Execution
// ============================================================================
console.log('🔧 Auto-Fix ESLint Errors\n');

let fixed = 0;
let failed = 0;

console.log('📝 Fixing no-promise-executor-return (11 files)...');
for (const fix of promiseExecutorFixes) {
    if (applyFix(fix.file, fix.pattern, fix.replacement)) {
        fixed++;
    } else {
        failed++;
    }
}

console.log('\n📝 Fixing no-proto (2 files)...');
for (const fix of protoFixes) {
    if (applyFix(fix.file, fix.pattern, fix.replacement)) {
        fixed++;
    } else {
        failed++;
    }
}

console.log('\n📝 Adding eslint-disable for no-control-regex (2 files)...');
for (const fix of controlRegexFixes) {
    if (addCommentBeforeLine(fix.file, fix.line, fix.addComment)) {
        fixed++;
    } else {
        failed++;
    }
}

console.log('\n' + '='.repeat(60));
console.log(`✅ Fixed: ${fixed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total: ${fixed + failed}`);
console.log('='.repeat(60));

console.log('\n🎯 Next Steps:');
console.log('1. Run: npx eslint . --quiet');
console.log('2. Verify fixes worked (should have 3 errors left: CONFIG)');
console.log('3. Test affected files');

process.exit(failed > 0 ? 1 : 0);
