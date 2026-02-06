#!/usr/bin/env nodeimport assert from 'node:assert';
import EventEmitter from 'node:events';

/* ==========================================================================
   MOCK SETUP
========================================================================== */

// Mock logger (global)
global.log = (level, msg) => {
    if (process.env.TEST_VERBOSE === '1') {
        console.log(`[${level}] ${msg}`);
    }
};

// Mock BrowserPoolManager
class MockBrowserPoolManager {
    constructor() {
        this.browser = {
            isConnected: () => true,
            targets: async () => [{ type: () => 'page' }, { type: () => 'page' }],
        };
        this.nerv = null;
    }

    getActivePages() {
        return [
            {
                page: {
                    isClosed: () => false,
                    metrics: async () => ({
                        JSHeapUsedSize: 100 * 1024 * 1024, // 100MB
                        JSHeapTotalSize: 200 * 1024 * 1024, // 200MB
                        Nodes: 5000,
                    }),
                },
                taskId: 'test-task-1',
            },
        ];
    }
}

import PeriodicHealthMonitor from '#infra/browser_pool/PeriodicHealthMonitor';
const { HEALTH_STATUS, CHECK_TYPES, MONITOR_EVENTS, MONITOR_CONFIG } = PeriodicHealthMonitor;

async function runTests() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Phase 3 Integration Test - Monitoring & Reconnection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    let passedTests = 0;
    let totalTests = 0;

    /* ======================================================================
       Test 1: PeriodicHealthMonitor Initialization
    ====================================================================== */
    totalTests++;
    try {
        console.log('Test 1: PeriodicHealthMonitor initialization...');

        const poolManager = new MockBrowserPoolManager();
        const monitor = new PeriodicHealthMonitor(poolManager);

        assert.strictEqual(monitor.isRunning, false, 'Monitor should not be running initially');
        assert.strictEqual(monitor.currentStatus, HEALTH_STATUS.HEALTHY, 'Initial status should be HEALTHY');
        assert(monitor.stats, 'Stats should exist');
        assert.strictEqual(monitor.stats.totalChecks, 0, 'Total checks should be 0');
        assert.deepStrictEqual(monitor.healthHistory, [], 'Health history should be empty');

        console.log('  ✅ Monitor initialized correctly');
        console.log('  ✅ Initial state validated');
        console.log('  ✅ Stats structure correct');
        passedTests++;
    } catch (err) {
        console.error(`  ❌ Test 1 failed: ${err.message}`);
    }

    /* ======================================================================
       Test 2: CDP-based Health Checks
    ====================================================================== */
    totalTests++;
    try {
        console.log('Test 2: CDP-based health checks...');

        const poolManager = new MockBrowserPoolManager();
        const monitor = new PeriodicHealthMonitor(poolManager);

        // Run single health check
        const results = await monitor.runHealthCheck();

        assert(results, 'Results should exist');
        assert(results.timestamp, 'Timestamp should exist');
        assert(results.checks, 'Checks should exist');
        assert(results.checks[CHECK_TYPES.CONNECTION], 'Connection check should exist');
        assert(results.checks[CHECK_TYPES.PAGE_MEMORY], 'Page memory check should exist');
        assert(results.checks[CHECK_TYPES.PAGE_TARGETS], 'Page targets check should exist');

        // Validate connection check
        const connCheck = results.checks[CHECK_TYPES.CONNECTION];
        assert.strictEqual(connCheck.passed, true, 'Connection check should pass');
        assert.strictEqual(connCheck.status, HEALTH_STATUS.HEALTHY, 'Connection should be HEALTHY');

        // Validate page memory check
        const memCheck = results.checks[CHECK_TYPES.PAGE_MEMORY];
        assert.strictEqual(memCheck.passed, true, 'Page memory check should pass');
        assert(memCheck.details, 'Memory details should exist');
        assert.strictEqual(memCheck.details.pageCount, 1, 'Page count should be 1');

        // Validate page targets check
        const targetsCheck = results.checks[CHECK_TYPES.PAGE_TARGETS];
        assert.strictEqual(targetsCheck.passed, true, 'Targets check should pass');
        assert.strictEqual(targetsCheck.details.pageTargets, 2, 'Should have 2 page targets');

        // Validate overall status
        assert.strictEqual(results.overallStatus, HEALTH_STATUS.HEALTHY, 'Overall status should be HEALTHY');

        // Validate stats
        assert.strictEqual(monitor.stats.totalChecks, 1, 'Total checks should be 1');
        assert.strictEqual(monitor.stats.passedChecks, 1, 'Passed checks should be 1');
        assert.strictEqual(monitor.stats.consecutiveFailures, 0, 'Consecutive failures should be 0');

        console.log('  ✅ Health check executed successfully');
        console.log('  ✅ All CDP checks passed (connection, memory, targets)');
        console.log('  ✅ Stats updated correctly');
        passedTests++;
    } catch (err) {
        console.error(`  ❌ Test 2 failed: ${err.message}`);
        if (process.env.TEST_VERBOSE === '1') {
            console.error(err.stack);
        }
    }

    /* ======================================================================
       Test 3: Status Change Detection (HEALTHY → WARNING)
    ====================================================================== */
    totalTests++;
    try {
        console.log('Test 3: Status change detection (HEALTHY → WARNING)...');

        const poolManager = new MockBrowserPoolManager();

        // Mock page with high memory usage (warning threshold)
        poolManager.getActivePages = () => [
            {
                page: {
                    isClosed: () => false,
                    metrics: async () => ({
                        JSHeapUsedSize: 350 * 1024 * 1024, // 350MB (>300MB warning)
                        JSHeapTotalSize: 600 * 1024 * 1024,
                        Nodes: 5000,
                    }),
                },
                taskId: 'test-task-warning',
            },
        ];

        const monitor = new PeriodicHealthMonitor(poolManager);

        let statusChanged = false;
        let warningDetected = false;

        monitor.on(MONITOR_EVENTS.STATUS_CHANGED, data => {
            if (data.oldStatus === HEALTH_STATUS.HEALTHY && data.newStatus === HEALTH_STATUS.WARNING) {
                statusChanged = true;
            }
        });

        monitor.on(MONITOR_EVENTS.WARNING_DETECTED, () => {
            warningDetected = true;
        });

        // Run health check
        const results = await monitor.runHealthCheck();

        assert.strictEqual(results.overallStatus, HEALTH_STATUS.WARNING, 'Status should be WARNING');
        assert.strictEqual(statusChanged, true, 'STATUS_CHANGED event should fire');
        assert.strictEqual(warningDetected, true, 'WARNING_DETECTED event should fire');
        assert(results.issues.length > 0, 'Should have issues');

        // Check issue details
        const jsHeapIssue = results.issues.find(i => i.type === 'JS_HEAP_WARNING');
        assert(jsHeapIssue, 'Should have JS_HEAP_WARNING issue');
        assert.strictEqual(jsHeapIssue.severity, 'WARNING', 'Issue severity should be WARNING');
        assert.strictEqual(jsHeapIssue.value, 350, 'Issue value should be 350MB');

        console.log('  ✅ WARNING status detected correctly');
        console.log('  ✅ Status change event fired');
        console.log('  ✅ Warning event fired');
        console.log('  ✅ Issue details correct');
        passedTests++;
    } catch (err) {
        console.error(`  ❌ Test 3 failed: ${err.message}`);
        if (process.env.TEST_VERBOSE === '1') {
            console.error(err.stack);
        }
    }

    /* ======================================================================
       Test 4: CRITICAL Status Detection (Connection Lost)
    ====================================================================== */
    totalTests++;
    try {
        console.log('Test 4: CRITICAL status detection (connection lost)...');

        const poolManager = new MockBrowserPoolManager();

        // Mock disconnected browser
        poolManager.browser.isConnected = () => false;

        const monitor = new PeriodicHealthMonitor(poolManager);

        let connectionLost = false;
        let recoveryNeeded = false;

        monitor.on(MONITOR_EVENTS.CONNECTION_LOST, () => {
            connectionLost = true;
        });

        monitor.on(MONITOR_EVENTS.RECOVERY_NEEDED, data => {
            if (data.reason === 'CONNECTION_LOST') {
                recoveryNeeded = true;
            }
        });

        // Run health check
        const results = await monitor.runHealthCheck();

        assert.strictEqual(results.overallStatus, HEALTH_STATUS.DISCONNECTED, 'Status should be DISCONNECTED');
        assert.strictEqual(connectionLost, true, 'CONNECTION_LOST event should fire');
        assert.strictEqual(recoveryNeeded, true, 'RECOVERY_NEEDED event should fire');

        // Check connection issue
        const connIssue = results.issues.find(i => i.type === CHECK_TYPES.CONNECTION);
        assert(connIssue, 'Should have CONNECTION issue');
        assert.strictEqual(connIssue.severity, 'CRITICAL', 'Connection issue should be CRITICAL');
        assert.strictEqual(connIssue.action, 'RECONNECT_NEEDED', 'Should need reconnection');

        console.log('  ✅ DISCONNECTED status detected');
        console.log('  ✅ CONNECTION_LOST event fired');
        console.log('  ✅ RECOVERY_NEEDED event fired');
        console.log('  ✅ Reconnection action triggered');
        passedTests++;
    } catch (err) {
        console.error(`  ❌ Test 4 failed: ${err.message}`);
        if (process.env.TEST_VERBOSE === '1') {
            console.error(err.stack);
        }
    }

    /* ======================================================================
       Test 5: Periodic Monitoring Lifecycle
    ====================================================================== */
    totalTests++;
    try {
        console.log('Test 5: Periodic monitoring lifecycle...');

        const poolManager = new MockBrowserPoolManager();
        const monitor = new PeriodicHealthMonitor(poolManager);

        // Start monitoring
        monitor.start(100); // 100ms interval for test

        assert.strictEqual(monitor.isRunning, true, 'Monitor should be running');
        assert(monitor.intervalHandle, 'Interval handle should exist');

        // Wait for 2 checks (200ms + buffer)
        await new Promise(resolve => setTimeout(resolve, 250));

        assert(monitor.stats.totalChecks >= 2, `Should have at least 2 checks (got ${monitor.stats.totalChecks})`);

        // Stop monitoring
        monitor.stop();

        assert.strictEqual(monitor.isRunning, false, 'Monitor should be stopped');
        assert.strictEqual(monitor.intervalHandle, null, 'Interval handle should be null');

        const checksBeforeStop = monitor.stats.totalChecks;

        // Wait and verify no more checks
        await new Promise(resolve => setTimeout(resolve, 150));

        assert.strictEqual(monitor.stats.totalChecks, checksBeforeStop, 'Checks should not increase after stop');

        console.log('  ✅ Monitor start/stop lifecycle works');
        console.log(`  ✅ Periodic checks executed (${monitor.stats.totalChecks} checks)`);
        console.log('  ✅ Stop prevents further checks');
        passedTests++;
    } catch (err) {
        console.error(`  ❌ Test 5 failed: ${err.message}`);
        if (process.env.TEST_VERBOSE === '1') {
            console.error(err.stack);
        }
    }

    /* ======================================================================
       Test 6: Configuration & Thresholds
    ====================================================================== */
    totalTests++;
    try {
        console.log('Test 6: Configuration & thresholds validation...');

        // Validate MONITOR_CONFIG
        assert.strictEqual(MONITOR_CONFIG.HEALTH_CHECK_INTERVAL_MS, 30000, 'Default interval should be 30s');
        assert.strictEqual(MONITOR_CONFIG.QUICK_CHECK_INTERVAL_MS, 5000, 'Quick interval should be 5s');
        assert.strictEqual(MONITOR_CONFIG.MEMORY_WARNING_THRESHOLD_MB, 500, 'Memory warning should be 500MB');
        assert.strictEqual(MONITOR_CONFIG.MEMORY_CRITICAL_THRESHOLD_MB, 1000, 'Memory critical should be 1GB');
        assert.strictEqual(MONITOR_CONFIG.JS_HEAP_WARNING_THRESHOLD_MB, 300, 'JS heap warning should be 300MB');
        assert.strictEqual(MONITOR_CONFIG.JS_HEAP_CRITICAL_THRESHOLD_MB, 600, 'JS heap critical should be 600MB');
        assert.strictEqual(MONITOR_CONFIG.DOM_NODES_WARNING_THRESHOLD, 10000, 'DOM warning should be 10k');
        assert.strictEqual(MONITOR_CONFIG.DOM_NODES_CRITICAL_THRESHOLD, 50000, 'DOM critical should be 50k');
        assert.strictEqual(MONITOR_CONFIG.MAX_CONSECUTIVE_FAILURES, 3, 'Max failures should be 3');
        assert.strictEqual(MONITOR_CONFIG.RECONNECT_MAX_ATTEMPTS, 5, 'Max reconnect attempts should be 5');
        assert.strictEqual(MONITOR_CONFIG.RECONNECT_BACKOFF_BASE_MS, 2000, 'Base backoff should be 2s');
        assert.strictEqual(MONITOR_CONFIG.RECONNECT_BACKOFF_MAX_MS, 30000, 'Max backoff should be 30s');

        // Validate HEALTH_STATUS enum
        assert(HEALTH_STATUS.HEALTHY, 'HEALTHY status should exist');
        assert(HEALTH_STATUS.WARNING, 'WARNING status should exist');
        assert(HEALTH_STATUS.DEGRADED, 'DEGRADED status should exist');
        assert(HEALTH_STATUS.CRITICAL, 'CRITICAL status should exist');
        assert(HEALTH_STATUS.DISCONNECTED, 'DISCONNECTED status should exist');

        // Validate CHECK_TYPES enum
        assert(CHECK_TYPES.CONNECTION, 'CONNECTION check type should exist');
        assert(CHECK_TYPES.PAGE_MEMORY, 'PAGE_MEMORY check type should exist');
        assert(CHECK_TYPES.PAGE_TARGETS, 'PAGE_TARGETS check type should exist');
        assert(CHECK_TYPES.DOM_HEALTH, 'DOM_HEALTH check type should exist');

        // Validate MONITOR_EVENTS enum
        assert(MONITOR_EVENTS.HEALTH_CHECK_COMPLETE, 'HEALTH_CHECK_COMPLETE event should exist');
        assert(MONITOR_EVENTS.STATUS_CHANGED, 'STATUS_CHANGED event should exist');
        assert(MONITOR_EVENTS.WARNING_DETECTED, 'WARNING_DETECTED event should exist');
        assert(MONITOR_EVENTS.CRITICAL_ISSUE, 'CRITICAL_ISSUE event should exist');
        assert(MONITOR_EVENTS.CONNECTION_LOST, 'CONNECTION_LOST event should exist');
        assert(MONITOR_EVENTS.RECOVERY_NEEDED, 'RECOVERY_NEEDED event should exist');

        console.log('  ✅ All config constants validated');
        console.log('  ✅ Thresholds correctly defined');
        console.log('  ✅ Enums complete');
        passedTests++;
    } catch (err) {
        console.error(`  ❌ Test 6 failed: ${err.message}`);
        if (process.env.TEST_VERBOSE === '1') {
            console.error(err.stack);
        }
    }

    /* ======================================================================
       SUMMARY
    ====================================================================== */
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Passed: ${passedTests}/${totalTests}`);
    console.log(`Failed: ${totalTests - passedTests}/${totalTests}`);

    if (passedTests === totalTests) {
        console.log('');
        console.log('✅ ALL TESTS PASSED - Phase 3 implementation validated');
        process.exit(0);
    } else {
        console.log('');
        console.log('❌ SOME TESTS FAILED - Review Phase 3 implementation');
        process.exit(1);
    }
}

// Run tests
runTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
