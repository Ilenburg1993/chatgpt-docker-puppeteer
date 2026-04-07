// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { isDomainMatch } from '#core/domain_matcher';

test('wave15: domain matcher mantém match estrito por hostname/subdomínio', () => {
    assert.equal(isDomainMatch('https://chatgpt.com', 'chatgpt.com'), true);
    assert.equal(isDomainMatch('https://app.chatgpt.com', 'chatgpt.com'), true);
    assert.equal(isDomainMatch('https://evilchatgpt.com', 'chatgpt.com'), false);
    assert.equal(isDomainMatch('https://chatgpt.com.evil.org', 'chatgpt.com'), false);
});

test('wave15: DriverReadinessGuard usa isDomainMatch e evita includes vulnerável', async () => {
    const filePath = path.join(process.cwd(), 'src/driver/guards/DriverReadinessGuard.js');
    const content = await fs.readFile(filePath, 'utf8');

    assert.match(content, /isDomainMatch\s*\(/, 'guard deve validar domínio com helper estrito');
    assert.doesNotMatch(
        content,
        /currentUrl\.includes\s*\(\s*this\.driver\.config\.expectedDomain\s*\)/,
        'guard não deve usar includes para match de domínio',
    );
    assert.match(content, /current URL is empty/, 'guard deve tratar URL vazia com falha explícita');
});
