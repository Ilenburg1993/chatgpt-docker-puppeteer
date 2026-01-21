#!/usr/bin/env node
/**
 * Run All Tests - Comprehensive Test Runner with Report Generation
 *
 * Executes all test suites and generates a detailed final report.
 *
 * Usage:
 *   npm run test:all
 *   node scripts/run-all-tests.js
 *   node scripts/run-all-tests.js --watch
 *   node scripts/run-all-tests.js --json
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'logs', 'test-reports');

// ============================================================================
// Configuration
// ============================================================================

const TEST_SUITES = [
    {
        name: 'E2E: Ariadne Thread',
        path: 'tests/e2e/test_ariadne_thread.spec.js',
        category: 'e2e',
        critical: true,
        description: 'End-to-end connectivity validation (NERV ↔ KERNEL ↔ BrowserPool)'
    },
    {
        name: 'E2E: Boot Sequence',
        path: 'tests/e2e/test_boot_sequence.spec.js',
        category: 'e2e',
        critical: true,
        description: 'Complete system boot validation'
    },
    {
        name: 'E2E: Integration Complete',
        path: 'tests/e2e/test_integration_complete.spec.js',
        category: 'e2e',
        critical: true,
        description: 'Full integration test (cache, profiles, pool, allocation)'
    },
    {
        name: 'Regression: P1 Fixes',
        path: 'tests/regression/test_p1_fixes.spec.js',
        category: 'regression',
        critical: true,
        description: 'Critical fixes: Lock Manager, Promise Memoization'
    },
    {
        name: 'Regression: P2 Fixes',
        path: 'tests/regression/test_p2_fixes.spec.js',
        category: 'regression',
        critical: true,
        description: 'Critical fixes: Shutdown Isolation, HandleManager AbortController'
    },
    {
        name: 'Regression: P3 Fixes',
        path: 'tests/regression/test_p3_fixes.spec.js',
        category: 'regression',
        critical: true,
        description: 'Critical fixes: Kill Timeouts, Promise.race'
    },
    {
        name: 'Regression: P4-P5 Fixes',
        path: 'tests/regression/test_p4_p5_fixes.spec.js',
        category: 'regression',
        critical: true,
        description: 'Critical fixes: Observer Cleanup, Optimistic Locking, Cache Invalidation'
    }
];

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN: '\x1b[36m',
    BOLD: '\x1b[1m'
};

// ============================================================================
// Utilities
// ============================================================================

function colorize(text, color) {
    return `${COLORS[color]}${text}${COLORS.RESET}`;
}

function printHeader(title) {
    const line = '═'.repeat(70);
    console.log(`\n${colorize(line, 'CYAN')}`);
    console.log(colorize(`  ${title}`, 'BOLD'));
    console.log(`${colorize(line, 'CYAN')}\n`);
}

function printSection(title) {
    console.log(`\n${colorize('─'.repeat(70), 'BLUE')}`);
    console.log(colorize(`  ${title}`, 'CYAN'));
    console.log(`${colorize('─'.repeat(70), 'BLUE')}\n`);
}

// ============================================================================
// Test Execution
// ============================================================================

async function runTests() {
    printHeader('🧪 COMPREHENSIVE TEST SUITE RUNNER');

    console.log(`${colorize('📋 Test Suites:', 'BOLD')} ${TEST_SUITES.length}`);
    console.log(`${colorize('🎯 Critical Tests:', 'BOLD')} ${TEST_SUITES.filter(t => t.critical).length}`);
    console.log(`${colorize('📂 Categories:', 'BOLD')} e2e, regression`);
    console.log(`${colorize('⏰ Started:', 'BOLD')} ${new Date().toISOString()}\n`);

    const results = {
        suites: [],
        summary: {
            total: TEST_SUITES.length,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration: 0
        },
        startTime: Date.now(),
        endTime: null
    };

    // Run npm test
    printSection('🚀 EXECUTING TEST SUITES');

    const testProcess = spawn('npm', ['test'], {
        cwd: ROOT,
        stdio: 'pipe',
        shell: true
    });

    let output = '';
    const currentSuite = null;
    const suiteResults = new Map();

    testProcess.stdout.on('data', data => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);

        // Parse test results from output
        const lines = text.split('\n');
        for (const line of lines) {
            // Detect TAP suite results (ok/not ok lines)
            if (line.match(/^(not )?ok \d+ - .*\.spec\.js$/)) {
                const isPass = !line.startsWith('not ok');
                const match = line.match(/- (.+\.spec\.js)/);
                if (match) {
                    const fullPath = match[1];
                    const baseName = path.basename(fullPath);
                    suiteResults.set(baseName, { status: isPass ? 'passed' : 'failed', output: line });
                }
            }
            // Also detect ✔/✖ markers
            else if (line.includes('✔') && line.includes('.spec.js')) {
                const match = line.match(/✔\s+(.+\.spec\.js)/);
                if (match) {
                    const baseName = path.basename(match[1]);
                    if (!suiteResults.has(baseName)) {
                        suiteResults.set(baseName, { status: 'passed', output: line });
                    }
                }
            } else if (line.includes('✖') && line.includes('.spec.js')) {
                const match = line.match(/✖\s+(.+\.spec\.js)/);
                if (match) {
                    const baseName = path.basename(match[1]);
                    if (!suiteResults.has(baseName)) {
                        suiteResults.set(baseName, { status: 'failed', output: line });
                    }
                }
            }
        }
    });

    testProcess.stderr.on('data', data => {
        output += data.toString();
        process.stderr.write(data);
    });

    await new Promise(resolve => {
        testProcess.on('close', code => {
            results.endTime = Date.now();
            results.summary.duration = results.endTime - results.startTime;
            resolve(code);
        });
    });

    // Parse final results
    printSection('📊 PARSING TEST RESULTS');

    for (const suite of TEST_SUITES) {
        const fullPath = path.join(ROOT, suite.path);
        const relativePath = suite.path;

        let status = 'unknown';
        let details = '';

        // Check if suite result was detected
        for (const [detectedPath, result] of suiteResults.entries()) {
            if (detectedPath.includes(path.basename(suite.path))) {
                status = result.status;
                details = result.output;
                break;
            }
        }

        // Fallback: search in output
        if (status === 'unknown') {
            const suiteRegex = new RegExp(`(✔|✖).*${path.basename(suite.path)}`);
            const match = output.match(suiteRegex);
            if (match) {
                status = match[1] === '✔' ? 'passed' : 'failed';
                details = match[0];
            }
        }

        // Count score from output
        const scoreMatch = output.match(new RegExp(`📊 Score: (\\d+)/(\\d+).*${suite.name}`));
        let score = null;
        if (scoreMatch) {
            score = { passed: parseInt(scoreMatch[1]), total: parseInt(scoreMatch[2]) };
        }

        const suiteResult = {
            name: suite.name,
            path: relativePath,
            category: suite.category,
            critical: suite.critical,
            description: suite.description,
            status,
            score,
            details
        };

        results.suites.push(suiteResult);

        if (status === 'passed') {
            results.summary.passed++;
        } else if (status === 'failed') {
            results.summary.failed++;
        } else {
            results.summary.skipped++;
        }

        const icon = status === 'passed' ? '✅' : status === 'failed' ? '❌' : '⚠️';
        const color = status === 'passed' ? 'GREEN' : status === 'failed' ? 'RED' : 'YELLOW';
        const scoreText = score ? ` (${score.passed}/${score.total})` : '';

        console.log(`${icon} ${colorize(suite.name, color)}${scoreText}`);
        console.log(`   ${suite.description}`);
        if (details) {
            console.log(`   ${colorize(details, 'BLUE')}`);
        }
        console.log('');
    }

    // Generate Report
    printSection('📝 GENERATING REPORT');

    // Ensure reports directory exists
    if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const reportPath = path.join(REPORTS_DIR, `test-report-${timestamp}.json`);
    const reportMarkdownPath = path.join(REPORTS_DIR, `test-report-${timestamp}.md`);

    // JSON Report
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`${colorize('✓', 'GREEN')} JSON report: ${reportPath}`);

    // Markdown Report
    const markdown = generateMarkdownReport(results);
    fs.writeFileSync(reportMarkdownPath, markdown);
    console.log(`${colorize('✓', 'GREEN')} Markdown report: ${reportMarkdownPath}`);

    // Console Summary
    printSection('🎯 FINAL SUMMARY');

    console.log(`${colorize('Total Suites:', 'BOLD')} ${results.summary.total}`);
    console.log(`${colorize('✅ Passed:', 'GREEN')} ${results.summary.passed}`);
    console.log(`${colorize('❌ Failed:', 'RED')} ${results.summary.failed}`);
    console.log(`${colorize('⚠️  Skipped:', 'YELLOW')} ${results.summary.skipped}`);
    console.log(`${colorize('⏱️  Duration:', 'BLUE')} ${(results.summary.duration / 1000).toFixed(2)}s`);

    const passRate = ((results.summary.passed / results.summary.total) * 100).toFixed(1);
    console.log(`${colorize('📈 Pass Rate:', 'CYAN')} ${passRate}%`);

    const criticalTests = results.suites.filter(s => s.critical);
    const criticalPassed = criticalTests.filter(s => s.status === 'passed').length;
    console.log(`${colorize('🔴 Critical:', 'MAGENTA')} ${criticalPassed}/${criticalTests.length} passed`);

    // Exit code
    const exitCode = results.summary.failed > 0 ? 1 : 0;

    if (exitCode === 0) {
        printHeader('✨ ALL TESTS PASSED! ✨');
    } else {
        printHeader('⚠️  SOME TESTS FAILED');
        console.log(colorize('Review the report for details.', 'YELLOW'));
    }

    console.log(`\n${colorize('Reports saved to:', 'BOLD')} ${REPORTS_DIR}\n`);

    return exitCode;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateMarkdownReport(results) {
    const { suites, summary, startTime, endTime } = results;

    let md = '';

    md += '# Test Suite Report\n\n';
    md += `**Generated:** ${new Date(endTime).toISOString()}  \n`;
    md += `**Duration:** ${(summary.duration / 1000).toFixed(2)}s  \n\n`;

    md += '---\n\n';

    md += '## Summary\n\n';
    md += '| Metric | Value |\n';
    md += '|--------|-------|\n';
    md += `| Total Suites | ${summary.total} |\n`;
    md += `| ✅ Passed | ${summary.passed} |\n`;
    md += `| ❌ Failed | ${summary.failed} |\n`;
    md += `| ⚠️ Skipped | ${summary.skipped} |\n`;
    md += `| Pass Rate | ${((summary.passed / summary.total) * 100).toFixed(1)}% |\n\n`;

    md += '---\n\n';

    md += '## Test Suites\n\n';

    const e2eTests = suites.filter(s => s.category === 'e2e');
    const regressionTests = suites.filter(s => s.category === 'regression');

    md += '### E2E Tests\n\n';
    for (const suite of e2eTests) {
        const icon = suite.status === 'passed' ? '✅' : suite.status === 'failed' ? '❌' : '⚠️';
        const scoreText = suite.score ? ` **(${suite.score.passed}/${suite.score.total})**` : '';
        md += `${icon} **${suite.name}**${scoreText}  \n`;
        md += `   ${suite.description}  \n`;
        md += `   \`${suite.path}\`  \n\n`;
    }

    md += '### Regression Tests\n\n';
    for (const suite of regressionTests) {
        const icon = suite.status === 'passed' ? '✅' : suite.status === 'failed' ? '❌' : '⚠️';
        const scoreText = suite.score ? ` **(${suite.score.passed}/${suite.score.total})**` : '';
        md += `${icon} **${suite.name}**${scoreText}  \n`;
        md += `   ${suite.description}  \n`;
        md += `   \`${suite.path}\`  \n\n`;
    }

    md += '---\n\n';

    md += '## Critical Tests Status\n\n';
    const criticalTests = suites.filter(s => s.critical);
    const criticalPassed = criticalTests.filter(s => s.status === 'passed').length;
    md += `**${criticalPassed}/${criticalTests.length}** critical tests passed\n\n`;

    for (const suite of criticalTests) {
        const icon = suite.status === 'passed' ? '✅' : '❌';
        md += `- ${icon} ${suite.name}\n`;
    }

    md += '\n---\n\n';
    md += `*Report generated by \`scripts/run-all-tests.js\`*\n`;

    return md;
}

// ============================================================================
// Main
// ============================================================================

if (require.main === module) {
    runTests()
        .then(exitCode => {
            process.exit(exitCode);
        })
        .catch(err => {
            console.error(colorize('❌ Fatal error:', 'RED'), err);
            process.exit(1);
        });
}

module.exports = { runTests };
