import assert from 'node:assert';
import { test } from 'node:test';

import { getHardwareMetrics } from '../../../src/core/doctor.js';

test('doctor.getHardwareMetrics exposes cpu usage percent and loadavg split', () => {
    const metrics = getHardwareMetrics();

    assert.ok(metrics);
    assert.ok(typeof metrics.cpu_usage_percent === 'string');
    assert.ok(typeof metrics.cpu_load_1min === 'string');
    assert.ok(typeof metrics.cpu_load_5min === 'string');
    assert.ok(typeof metrics.cpu_load_15min === 'string');
    assert.ok(typeof metrics.cpu_cores === 'number' && metrics.cpu_cores >= 1);

    const cpuUsage = Number.parseFloat(metrics.cpu_usage_percent);
    assert.ok(Number.isFinite(cpuUsage));
    assert.ok(cpuUsage >= 0 && cpuUsage <= 100);
});
