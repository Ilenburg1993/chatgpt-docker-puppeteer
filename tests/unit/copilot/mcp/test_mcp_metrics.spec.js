// @ts-check
/** Tests for MCP runtime metrics. */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

import {
    activateMcpHttpRequestActivity,
    activateMcpHttpToolRequestTiming,
    readMcpMetricsSnapshot,
    recordMcpHttpRequestRpcMethod,
    recordMcpHttpToolHandlerEnd,
    recordMcpHttpToolHandlerStart,
    recordMcpToolInteractionEnd,
    recordMcpToolInteractionStart,
    recordMcpToolMetric,
    resetMcpMetricsForTests,
    runWithMcpHttpToolTimingContext,
} from '#copilot/mcp/control-plane';

beforeEach(() => {
    resetMcpMetricsForTests();
});

describe('MCP runtime metrics', () => {
    it('records per-tool phase latency without changing aggregate call metrics', () => {
        recordMcpToolMetric('repo_status', {
            durationMs: 20,
            isError: false,
            phases: {
                authorization: 2,
                handler: 15,
                auditCompletion: 1,
            },
        });
        recordMcpToolMetric('repo_status', {
            durationMs: 40,
            isError: true,
            phases: {
                authorization: 4,
                handler: 30,
                auditCompletion: 2,
            },
        });

        const snapshot = readMcpMetricsSnapshot();
        const metric = snapshot.tools['repo_status'];
        assert.equal(metric.calls, 2);
        assert.equal(metric.errors, 1);
        assert.equal(metric.averageDurationMs, 30);
        assert.equal(metric.phaseAverages['authorization'].averageDurationMs, 3);
        assert.equal(metric.phaseAverages['handler'].averageDurationMs, 23);
        assert.equal(metric.phaseAverages['auditCompletion'].averageDurationMs, 2);
    });

    it('records quiescent inter-tool gaps without misclassifying parallel calls', () => {
        assert.equal(recordMcpToolInteractionStart('tool-a', 1_000), null);
        recordMcpToolInteractionEnd('tool-a', 1_100);

        assert.equal(recordMcpToolInteractionStart('tool-b', 4_100), 3_000);
        recordMcpToolInteractionEnd('tool-b', 4_200);

        assert.equal(recordMcpToolInteractionStart('tool-c', 5_000), 800);
        assert.equal(recordMcpToolInteractionStart('tool-d', 5_010), null);
        recordMcpToolInteractionEnd('tool-c', 5_100);
        recordMcpToolInteractionEnd('tool-d', 5_200);

        assert.equal(recordMcpToolInteractionStart('tool-e', 10_200), 5_000);
        recordMcpToolInteractionEnd('tool-e', 10_300);

        const interaction = readMcpMetricsSnapshot().interaction;
        assert.equal(interaction.burstCount, 4);
        assert.equal(interaction.activeCalls, 0);
        assert.equal(interaction.gaps.count, 3);
        assert.equal(interaction.gaps.totalMs, 8_800);
        assert.equal(interaction.gaps.averageMs, 2_933);
        assert.equal(interaction.gaps.p50Ms, 3_000);
        assert.equal(interaction.gaps.p95Ms, 5_000);
        assert.equal(interaction.gaps.lastMs, 5_000);
        assert.equal(interaction.gaps.maxMs, 5_000);
        assert.deepEqual(interaction.lastTransition, {
            from: 'tool-d',
            to: 'tool-e',
            gapMs: 5_000,
            observedAt: 10_200,
        });
    });

    it('separates external HTTP gap from origin phases and excludes persistent streams from work coverage', async () => {
        await runWithMcpHttpToolTimingContext(
            { requestId: 'request-stream', receivedAt: 500, edgeColo: 'gru' },
            async () => {
                const persistent = activateMcpHttpRequestActivity({ httpMethod: 'GET', routeClass: 'mcp-stream' });
                assert.ok(persistent);
            },
        );

        let finishFirst = null;
        let finishFirstActivity = null;
        await runWithMcpHttpToolTimingContext(
            { requestId: 'request-a', receivedAt: 1_000, edgeColo: 'gru' },
            async () => {
                finishFirstActivity = activateMcpHttpRequestActivity({ httpMethod: 'POST', routeClass: 'mcp' });
                recordMcpHttpRequestRpcMethod('tools/call');
                finishFirst = activateMcpHttpToolRequestTiming('tool-a');
                recordMcpHttpToolHandlerStart('tool-a', 'call-a', 1_020);
                await Promise.resolve();
                recordMcpHttpToolHandlerEnd(1_100);
            },
        );
        assert.ok(finishFirst);
        assert.ok(finishFirstActivity);
        finishFirstActivity(200, 1_120);
        finishFirst(1_120);
        finishFirst(1_130);

        let finishTransientStream = null;
        await runWithMcpHttpToolTimingContext(
            { requestId: 'request-transient-stream', receivedAt: 1_500, edgeColo: 'gru' },
            async () => {
                finishTransientStream = activateMcpHttpRequestActivity({ httpMethod: 'GET', routeClass: 'mcp-stream' });
            },
        );
        assert.ok(finishTransientStream);
        finishTransientStream(200, 1_900);

        let finishAuxiliary = null;
        await runWithMcpHttpToolTimingContext(
            { requestId: 'request-list', receivedAt: 2_000, edgeColo: 'gru' },
            async () => {
                finishAuxiliary = activateMcpHttpRequestActivity({ httpMethod: 'POST', routeClass: 'mcp' });
                recordMcpHttpRequestRpcMethod('tools/list');
            },
        );
        assert.ok(finishAuxiliary);
        finishAuxiliary(200, 2_200);

        let finishSecond = null;
        let finishSecondActivity = null;
        await runWithMcpHttpToolTimingContext(
            { requestId: 'request-b', receivedAt: 5_000, edgeColo: 'iad' },
            async () => {
                finishSecondActivity = activateMcpHttpRequestActivity({ httpMethod: 'POST', routeClass: 'mcp' });
                recordMcpHttpRequestRpcMethod('tools/call');
                finishSecond = activateMcpHttpToolRequestTiming('tool-b');
                await Promise.resolve();
                recordMcpHttpToolHandlerStart('tool-b', 'call-b', 5_030);
                recordMcpHttpToolHandlerEnd(5_100);
            },
        );
        assert.ok(finishSecond);
        assert.ok(finishSecondActivity);
        finishSecondActivity(200, 5_140);
        finishSecond(5_140);

        const boundary = readMcpMetricsSnapshot().interaction.originBoundary;
        assert.equal(boundary.requestCount, 2);
        assert.equal(boundary.burstCount, 2);
        assert.equal(boundary.activeRequests, 0);
        assert.equal(boundary.externalGaps.count, 1);
        assert.equal(boundary.externalGaps.lastMs, 3_880);
        assert.equal(boundary.preHandler.count, 2);
        assert.equal(boundary.preHandler.averageMs, 25);
        assert.equal(boundary.postHandler.count, 2);
        assert.equal(boundary.postHandler.averageMs, 30);
        assert.equal(boundary.lastTransition?.from, 'tool-a');
        assert.equal(boundary.lastTransition?.to, 'tool-b');
        assert.equal(boundary.lastTransition?.previousEdgeColo, 'GRU');
        assert.equal(boundary.lastTransition?.edgeColo, 'IAD');
        assert.equal(boundary.lastTransition?.interveningRequests.count, 2);
        assert.equal(boundary.lastTransition?.interveningRequests.persistentCrossGapCount, 1);
        assert.equal(boundary.lastTransition?.interveningRequests.streamRequestCount, 1);
        assert.equal(boundary.lastTransition?.interveningRequests.streamActiveAtToolArrivalCount, 0);
        assert.equal(boundary.lastTransition?.interveningRequests.coveredMs, 200);
        assert.equal(boundary.lastTransition?.interveningRequests.silentMs, 3_680);
        assert.equal(boundary.lastTransition?.interveningRequests.firstAuxiliaryDelayMs, 880);
        assert.equal(boundary.lastTransition?.interveningRequests.tailSilentAfterAuxiliaryMs, 2_800);
        assert.equal(boundary.lastTransition?.interveningRequests.auxiliarySpanMs, 200);
        assert.equal(boundary.silentExternalGaps.count, 1);
        assert.equal(boundary.silentExternalGaps.p50Ms, 3_680);
        assert.equal(boundary.silentExternalGaps.p95Ms, 3_680);
        assert.equal(boundary.auxiliaryCoverage.p50Ms, 200);
        assert.equal(boundary.auxiliaryCoverage.overallCoverageRatio, 0.051546);
        assert.equal(boundary.discreteAuxiliaryTiming.count, 1);
        assert.equal(boundary.discreteAuxiliaryTiming.firstDelayP50Ms, 880);
        assert.equal(boundary.discreteAuxiliaryTiming.tailSilentP50Ms, 2_800);
        assert.equal(boundary.discreteAuxiliaryTiming.firstDelayToExternalP50Ratio, 0.226804);
        assert.equal(boundary.discreteAuxiliaryTiming.lastFirstDiscreteRpcMethod, 'tools/list');
        assert.equal(boundary.discreteAuxiliaryTiming.lastFirstDiscreteRoute, 'mcp');
        assert.deepEqual(boundary.lastTransition?.interveningRequests.byRoute, { 'mcp-stream': 1, mcp: 1 });
        assert.deepEqual(boundary.lastTransition?.interveningRequests.byRpcMethod, { 'tools/list': 1 });
        assert.deepEqual(boundary.edgeColoCounts, { GRU: 1, IAD: 1 });
        assert.deepEqual(boundary.externalGapsByEdgeColo, [
            { edgeColo: 'IAD', calls: 1, gapSamples: 1, averageMs: 3_880, p50Ms: 3_880, p95Ms: 3_880, maxMs: 3_880 },
        ]);
        assert.equal(boundary.requestActivity.totalRequests, 5);
        assert.equal(boundary.requestActivity.completedRequests, 4);
        assert.equal(boundary.requestActivity.activeRequests, 1);
        assert.deepEqual(boundary.requestActivity.byRoute, { mcp: 3, 'mcp-stream': 2 });
        assert.deepEqual(boundary.requestActivity.byRpcMethod, { 'tools/call': 2, 'tools/list': 1 });
    });

    it('bounds dynamic tool and phase cardinality and safely handles special keys', () => {
        for (let index = 0; index < 1100; index += 1) {
            recordMcpToolMetric(`dynamic_${index}`, {
                durationMs: index,
                isError: false,
            });
        }
        recordMcpToolMetric('__proto__', {
            durationMs: 1,
            isError: false,
            phases: Object.fromEntries([
                ...Array.from({ length: 70 }, (_, index) => [`phase_${index}`, index]),
                ['__proto__', 1],
            ]),
        });

        const snapshot = readMcpMetricsSnapshot();
        assert.equal(snapshot.totals.tools, 1000);
        assert.equal(snapshot.tools['dynamic_0'], undefined);
        assert.equal(snapshot.tools['__proto__'].calls, 1);
        assert.equal(Object.keys(snapshot.tools['__proto__'].phaseAverages).length, 64);
        assert.equal(snapshot.tools['__proto__'].phaseAverages['__proto__'].calls, 1);
    });
});
