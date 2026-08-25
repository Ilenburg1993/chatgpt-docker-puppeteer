// @ts-check

import { createCloudflareEnvironmentAuthority } from '#copilot/mcp/public/cloudflare/environment-authority';
import { projectCloudflareAuthorityFileEnvironment } from '#copilot/testing/mcp/cloudflare';
import { describe, expect, it } from 'vitest';

describe('mcp/cloudflare environment authority', () => {
    it('projects only allowlisted Cloudflare/MCP keys from .env.local', () => {
        const projected = projectCloudflareAuthorityFileEnvironment({
            CLOUDFLARE_API_TOKEN: 'cloudflare-secret',
            CLOUDFLARE_ACCOUNT_ID: 'account-id',
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: 'https://mcp.example.com/mcp',
            DATABASE_URL: 'must-never-enter-cloudflare-authority',
            OPENAI_API_KEY: 'must-never-enter-cloudflare-authority',
            AURELIN_UNRELATED_SECRET: 'must-never-enter-cloudflare-authority',
        });

        expect(projected['CLOUDFLARE_API_TOKEN']).toBe('cloudflare-secret');
        expect(projected['CLOUDFLARE_ACCOUNT_ID']).toBe('account-id');
        expect(projected['COPILOT_MCP_CLOUDFLARE_PUBLIC_URL']).toBe('https://mcp.example.com/mcp');
        expect(projected['DATABASE_URL']).toBeUndefined();
        expect(projected['OPENAI_API_KEY']).toBeUndefined();
        expect(projected['AURELIN_UNRELATED_SECRET']).toBeUndefined();
        expect(Object.isFrozen(projected)).toBe(true);
    });

    it('serializes only authority metadata and never captured secret values', () => {
        const authority = createCloudflareEnvironmentAuthority({
            PATH: '/usr/bin',
            CLOUDFLARE_API_TOKEN: 'secret-token-that-must-not-serialize',
            CLOUDFLARE_ACCOUNT_ID: 'secret-account-that-must-not-serialize',
            AURELIN_UNRELATED_SECRET: 'never-captured',
        });
        const serialized = JSON.stringify(authority);

        expect(serialized).toContain('copilot-mcp-cloudflare-environment-authority');
        expect(serialized).toContain('credentialsExposed');
        expect(serialized).not.toContain('secret-token-that-must-not-serialize');
        expect(serialized).not.toContain('secret-account-that-must-not-serialize');
        expect(serialized).not.toContain('never-captured');
    });
});
