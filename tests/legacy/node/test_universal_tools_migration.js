#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ============================================
// ANSI Colors
// ============================================
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    bold: '\x1b[1m',
};

// ============================================
// Test State
// ============================================
let passCount = 0;
let failCount = 0;
const failures = [];

// ============================================
// Helper Functions
// ============================================

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function pass(testName) {
    passCount++;
    log(`✅ PASS: ${testName}`, 'green');
}

function fail(testName, reason) {
    failCount++;
    failures.push({ testName, reason });
    log(`❌ FAIL: ${testName}`, 'red');
    log(`   Reason: ${reason}`, 'yellow');
}

function section(title) {
    log(`\n${'='.repeat(50)}`, 'blue');
    log(title, 'bold');
    log('='.repeat(50), 'blue');
}

// ============================================
// Test 1: Verify Old Files Removed
// ============================================

section('Test 1: Verify Old Files Removed');

const oldFiles = ['src/driver/modules/human.js', 'src/driver/modules/stabilizer.js'];

oldFiles.forEach(file => {
    const fullPath = path.join(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
        fail(`Old file removed: ${file}`, 'File still exists (should be deleted)');
    } else {
        pass(`Old file removed: ${file}`);
    }
});

// ============================================
// Test 2: Verify New Files Exist
// ============================================

section('Test 2: Verify New Files Exist');

const newFiles = [
    'src/shared/biomechanics/human.js',
    'src/shared/page_stability/stabilizer.js',
    'src/shared/biomechanics/README.md',
    'src/shared/page_stability/README.md',
];

newFiles.forEach(file => {
    const fullPath = path.join(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
        pass(`New file exists: ${file}`);
    } else {
        fail(`New file exists: ${file}`, 'File not found');
    }
});

// ============================================
// Test 3: Verify Modules Load Without Errors
// ============================================

section('Test 3: Verify Modules Load Without Errors');

const modulesToLoad = [
    { path: 'src/shared/biomechanics/human.js', name: 'Human Biomechanics' },
    { path: 'src/shared/page_stability/stabilizer.js', name: 'Page Stabilizer' },
    { path: 'src/driver/modules/biomechanics_engine.js', name: 'Biomechanics Engine' },
    { path: 'src/driver/modules/triage.js', name: 'Triage System' },
    { path: 'src/driver/modules/recovery_system.js', name: 'Recovery System' },
];

for (const { path: modulePath, name } of modulesToLoad) {
    try {
        const fullPath = path.join(process.cwd(), modulePath);
        await import(pathToFileURL(fullPath).href);
        pass(`Module loads: ${name}`);
    } catch (err) {
        fail(`Module loads: ${name}`, err.message);
    }
}

// ============================================
// Test 4: Verify Function Exports
// ============================================

section('Test 4: Verify Function Exports');

try {
    const human = await import(pathToFileURL(path.join(process.cwd(), 'src/shared/biomechanics/human.js')).href);

    const humanFunctions = ['humanClick', 'humanType', 'wakeUpMove'];
    humanFunctions.forEach(fn => {
        if (typeof human[fn] === 'function') {
            pass(`human.${fn} exported`);
        } else {
            fail(`human.${fn} exported`, `Function not found or not a function (type: ${typeof human[fn]})`);
        }
    });
} catch (err) {
    fail('human.js exports', err.message);
}

try {
    const stabilizer = await import(
        pathToFileURL(path.join(process.cwd(), 'src/shared/page_stability/stabilizer.js')).href
    );

    const stabilizerFunctions = ['waitForStability', 'measureEventLoopLag', 'getPageLoadStatus'];
    stabilizerFunctions.forEach(fn => {
        if (typeof stabilizer[fn] === 'function') {
            pass(`stabilizer.${fn} exported`);
        } else {
            fail(`stabilizer.${fn} exported`, `Function not found or not a function (type: ${typeof stabilizer[fn]})`);
        }
    });
} catch (err) {
    fail('stabilizer.js exports', err.message);
}

// ============================================
// Test 5: Verify Import Updates
// ============================================

section('Test 5: Verify Import Updates');

const filesToCheck = [
    {
        path: 'src/driver/modules/biomechanics_engine.js',
        oldImports: ["require('./human')", "require('./stabilizer')"],
        newImports: ["require('@shared/biomechanics/human')", "require('@shared/page_stability/stabilizer')"],
    },
    {
        path: 'src/driver/modules/triage.js',
        oldImports: ["require('./stabilizer')"],
        newImports: ["require('@shared/page_stability/stabilizer')"],
    },
    {
        path: 'src/driver/modules/recovery_system.js',
        oldImports: ["require('./stabilizer')"],
        newImports: ["require('@shared/page_stability/stabilizer')"],
    },
];

filesToCheck.forEach(({ path: filePath, oldImports, newImports }) => {
    const fullPath = path.join(process.cwd(), filePath);

    if (!fs.existsSync(fullPath)) {
        fail(`Import check: ${filePath}`, 'File not found');
        return;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');

    // Check no old imports remain
    const hasOldImports = oldImports.some(oldImport => content.includes(oldImport));
    if (hasOldImports) {
        fail(`No old imports: ${filePath}`, 'Old relative imports still present');
    } else {
        pass(`No old imports: ${filePath}`);
    }

    // Check new imports exist
    const hasNewImports = newImports.every(newImport => content.includes(newImport));
    if (hasNewImports) {
        pass(`New imports present: ${filePath}`);
    } else {
        fail(`New imports present: ${filePath}`, 'Expected @shared imports not found');
    }
});

// ============================================
// Test 6: Verify ESLint (Optional - requires ESLint)
// ============================================

section('Test 6: Verify ESLint (Optional)');

try {
    const eslintPath = path.join(process.cwd(), 'node_modules/.bin/eslint');

    if (fs.existsSync(eslintPath)) {
        const filesToLint = [
            'src/shared/biomechanics/human.js',
            'src/shared/page_stability/stabilizer.js',
            'src/driver/modules/biomechanics_engine.js',
            'src/driver/modules/triage.js',
            'src/driver/modules/recovery_system.js',
        ];

        filesToLint.forEach(file => {
            try {
                execSync(`"${eslintPath}" "${file}" --max-warnings 0`, {
                    stdio: 'pipe',
                    cwd: process.cwd(),
                });
                pass(`ESLint: ${file}`);
            } catch (err) {
                // ESLint exits with code 1 on errors
                const stderr = err.stderr ? err.stderr.toString() : err.message;
                fail(`ESLint: ${file}`, `Linting errors found:\n${stderr}`);
            }
        });
    } else {
        log('⚠️  SKIP: ESLint not found (optional check)', 'yellow');
    }
} catch (err) {
    log(`⚠️  SKIP: ESLint check failed: ${err.message}`, 'yellow');
}

// ============================================
// Test 7: Verify README Content
// ============================================

section('Test 7: Verify README Content');

const readmesToCheck = [
    {
        path: 'src/shared/biomechanics/README.md',
        requiredSections: ['Overview', 'API Reference', 'humanClick', 'humanType', 'wakeUpMove'],
    },
    {
        path: 'src/shared/page_stability/README.md',
        requiredSections: ['Overview', 'API Reference', 'waitForStability', 'measureEventLoopLag', 'getPageLoadStatus'],
    },
];

readmesToCheck.forEach(({ path: readmePath, requiredSections }) => {
    const fullPath = path.join(process.cwd(), readmePath);

    if (!fs.existsSync(fullPath)) {
        fail(`README exists: ${readmePath}`, 'File not found');
        return;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');

    requiredSections.forEach(section => {
        if (content.includes(section)) {
            pass(`README section: ${readmePath} → ${section}`);
        } else {
            fail(`README section: ${readmePath} → ${section}`, 'Section missing in README');
        }
    });
});

// ============================================
// Final Report
// ============================================

section('Final Report');

log(`\n📊 Test Results:`, 'bold');
log(`   ✅ Passed: ${passCount}`, 'green');
log(`   ❌ Failed: ${failCount}`, failCount > 0 ? 'red' : 'green');
log(`   📈 Success Rate: ${((passCount / (passCount + failCount)) * 100).toFixed(1)}%\n`);

if (failCount > 0) {
    log('\n🔍 Failure Details:', 'bold');
    failures.forEach(({ testName, reason }) => {
        log(`\n❌ ${testName}`, 'red');
        log(`   ${reason}`, 'yellow');
    });

    log('\n💡 Migration Status: ❌ INCOMPLETE (see failures above)', 'red');
    process.exit(1);
} else {
    log('🎉 Migration Status: ✅ COMPLETE (all tests passed)', 'green');
    log('\n✅ human.js and stabilizer.js successfully migrated to shared/ layer', 'green');
    log('✅ All imports updated correctly', 'green');
    log('✅ All modules load without errors', 'green');
    log('✅ Documentation complete (READMEs)', 'green');

    log('\n📋 Next Steps:', 'bold');
    log('   1. Run integration tests: make test-fast', 'blue');
    log('   2. Upgrade human.js to v2.0 (consolidate + improve)', 'blue');
    log('   3. Upgrade stabilizer.js to v2.0 (consolidate + improve)', 'blue');

    process.exit(0);
}
