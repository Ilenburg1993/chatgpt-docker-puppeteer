// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildRuntimeRouteMetaPayload,
    normalizeRuntimeRouteMeta,
} from '../../../src/copilot/presentation/runtime-meta.js';

describe('presentation/runtime-meta', () => {
    it('normaliza string legada para objeto com runtimeId', () => {
        expect(normalizeRuntimeRouteMeta('default')).toEqual({ runtimeId: 'default' });
    });

    it('preserva metadata estruturada sem mutar shape', () => {
        expect(
            normalizeRuntimeRouteMeta({
                runtimeId: 'default',
                requestedRuntimeId: 'alt',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
            }),
        ).toEqual({
            runtimeId: 'default',
            requestedRuntimeId: 'alt',
            runtimeFound: false,
            usedDefaultRuntimeFallback: true,
        });
    });

    it('projeta payload apenas com campos definidos', () => {
        expect(
            buildRuntimeRouteMetaPayload({
                runtimeId: 'default',
                requestedRuntimeId: null,
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
            }),
        ).toEqual({
            runtimeId: 'default',
            requestedRuntimeId: null,
            runtimeFound: false,
            usedDefaultRuntimeFallback: true,
        });

        expect(buildRuntimeRouteMetaPayload(undefined)).toEqual({});
    });
});
