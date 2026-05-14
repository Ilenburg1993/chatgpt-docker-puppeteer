// @ts-check

import { describe, expect, it } from 'vitest';

import {
    IO_CAPABILITY,
    IO_RISK,
    capabilityForCreate,
    riskForDryRun,
    riskForOverwrite,
} from '../../../../src/copilot/infra/policy/index.js';

describe('infra/policy capabilities/risk', () => {
    it('mantém capabilities canônicas de arquivo', () => {
        expect(IO_CAPABILITY.fileWrite).toBe('file.write');
        expect(IO_CAPABILITY.filePatch).toBe('file.patch');
        expect(capabilityForCreate(false)).toBe('file.create');
        expect(capabilityForCreate(true)).toBe('file.create-or-overwrite');
    });

    it('calcula risco de overwrite e dry-run de forma consistente', () => {
        expect(riskForOverwrite(false)).toBe(IO_RISK.medium);
        expect(riskForOverwrite(true)).toBe(IO_RISK.high);
        expect(riskForDryRun(true)).toBe(IO_RISK.low);
        expect(riskForDryRun(false, IO_RISK.medium)).toBe(IO_RISK.medium);
    });
});
