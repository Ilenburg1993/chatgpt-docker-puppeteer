// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { INFRA_PUBLIC_API_MANIFEST } from '#copilot/infra/public/diagnostic/governance';
import { renderInfraPublicApiReference } from '../../../../scripts/analysis/infra-public-api-reference.mjs';

describe('Infra public API generated reference', () => {
    it('projects the complete governed inventory and authority metadata', async () => {
        const rendered = await renderInfraPublicApiReference();
        assert.match(
            rendered,
            new RegExp(`Entrypoints governados: \\*\\*${INFRA_PUBLIC_API_MANIFEST.length}\\*\\*\\.`),
        );
        assert.match(rendered, /\| Path authority \| Raw path \| Issuer \|/u);
        assert.match(
            rendered,
            /#copilot\/infra\/public\/composition\/database\/sqlite` \| composition \| lifecycle \| configured-bound \| yes \| yes \|/u,
        );
        assert.match(
            rendered,
            /#copilot\/infra\/public\/testing\/database\/sqlite` \| test \| lifecycle \| test-only \| yes \| yes \|/u,
        );
    });
});
