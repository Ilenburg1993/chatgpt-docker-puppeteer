// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { v4 as uuidv4 } from 'uuid';

function createMockPage() {
    const uid = uuidv4();

    const page = {
        _id: uid,
        _url: 'about:blank',
        _closed: false,
        url() {
            return this._url;
        },
        async goto(url, _ = {}) {
            this._url = url;
            // pequeno delay simulado para aproximar comportamento real
            await new Promise(resolve => setTimeout(resolve, 5));
            return { ok: true };
        },
        async title() {
            return `Mock Page - ${this._url.replace(/^https?:\/\//, '')}`;
        },
        async setDefaultNavigationTimeout() {
            return;
        },
        async setViewport() {
            return;
        },
        async evaluate(fn, ...args) {
            if (typeof fn === 'function') {
                try {
                    return fn(...args);
                } catch (e) {
                    return null;
                }
            }
            return null;
        },
        async content() {
            return `<html><head><title>${await this.title()}</title></head><body>Mock</body></html>`;
        },
        async screenshot() {
            return Buffer.from('');
        },
        async close() {
            this._closed = true;
            return;
        },
        isClosed() {
            return !!this._closed;
        },
        async bringToFront() {
            return;
        },
        async setUserAgent() {
            return;
        },
    };

    return page;
}

/**
 * Função exportada: createMockBrowser.
 * @returns {any}
 */
function createMockBrowser() {
    const pages = [createMockPage()];

    const browser = {
        __mock: true,
        isConnected() {
            return true;
        },
        on() {
            // noop
        },
        off() {
            // noop
        },
        disconnect() {
            // noop - kept for compatibility with BrowserPool shutdown
            return;
        },
        async pages() {
            return pages;
        },
        async newPage() {
            const p = createMockPage();
            pages.push(p);
            return p;
        },
        async close() {
            for (const p of pages) {
                try {
                    if (!p.isClosed()) await p.close();
                } catch (e) {
                    // swallow
                }
            }
            return;
        },
    };

    // Return a promise for parity with puppeteer.connect()
    return Promise.resolve(browser);
}

export { createMockBrowser };
