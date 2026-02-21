import test from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';

import { isDomainMatch } from '#core/domain_matcher';
import TargetDriver from '#driver/core/TargetDriver';

class FakeTargetDriver extends TargetDriver {
    constructor(config) {
        super(config);
        this.name = 'FakeTargetDriver';
    }

    async execute() {
        return 'ok';
    }
}

function createPage(url) {
    const page = new EventEmitter();
    page.url = () => url;
    page.isClosed = () => false;
    return page;
}

test('wave14: domain helper accepts exact/subdomain and rejects false positives', () => {
    assert.equal(isDomainMatch('https://chatgpt.com', 'chatgpt.com'), true);
    assert.equal(isDomainMatch('https://labs.chatgpt.com/path', 'chatgpt.com'), true);
    assert.equal(isDomainMatch('https://evilchatgpt.com', 'chatgpt.com'), false);
    assert.equal(isDomainMatch('https://chatgpt.com.evil.com', 'chatgpt.com'), false);
});

test('wave14: TargetDriver attachContext rejects domain mismatch with strict hostname match', () => {
    const driver = new FakeTargetDriver({
        target: 'chatgpt',
        expectedDomain: 'chatgpt.com',
    });

    const abortController = new AbortController();
    const evilPage = createPage('https://evilchatgpt.com');

    assert.throws(
        () => driver.attachContext(evilPage, abortController.signal, 'corr-evil'),
        /Domain mismatch/,
        'attachContext should reject lookalike domains'
    );
});

test('wave14: TargetDriver attachContext accepts exact and subdomain matches', () => {
    const exactDriver = new FakeTargetDriver({
        target: 'chatgpt',
        expectedDomain: 'chatgpt.com',
    });
    const exactPage = createPage('https://chatgpt.com/chat');
    exactDriver.attachContext(exactPage, new AbortController().signal, 'corr-exact');
    exactDriver.detachContext({ force: true });

    const subdomainDriver = new FakeTargetDriver({
        target: 'chatgpt',
        expectedDomain: 'chatgpt.com',
    });
    const subdomainPage = createPage('https://foo.chatgpt.com/chat');
    subdomainDriver.attachContext(subdomainPage, new AbortController().signal, 'corr-subdomain');
    subdomainDriver.detachContext({ force: true });
});
