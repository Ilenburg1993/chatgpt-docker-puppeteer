// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildRuntimeRouteMetaFromSelection,
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

    it('projeta metadata canônica a partir de seleção de runtime', () => {
        expect(
            buildRuntimeRouteMetaFromSelection({
                runtimeId: 'default',
                requestedRuntimeId: 'missing',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
            }),
        ).toEqual({
            runtimeId: 'default',
            requestedRuntimeId: 'missing',
            runtimeFound: false,
            usedDefaultRuntimeFallback: true,
        });
    });
});
