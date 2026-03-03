// @ts-check
import sinon from 'sinon';

/**
 * Cria uma página mockada do Puppeteer
  * @returns {object}
 */
function criarPaginaMock() {
    return {
        goto: sinon.stub().resolves(),
        waitForSelector: sinon.stub().resolves(),
        type: sinon.stub().resolves(),
        click: sinon.stub().resolves(),
        evaluate: sinon.stub().resolves(),
        $: sinon.stub().resolves(null),
        $$: sinon.stub().resolves([]),
        url: sinon.stub().returns('https://example.com'),
        title: sinon.stub().resolves('Test Page'),
        content: sinon.stub().resolves('<html></html>'),
        screenshot: sinon.stub().resolves(Buffer.from('fake-screenshot')),
        close: sinon.stub().resolves(),
        isClosed: sinon.stub().returns(false),

        // Métodos adicionais
        setViewport: sinon.stub().resolves(),
        setUserAgent: sinon.stub().resolves(),

        // Helpers
        limpar: function () {
            Object.keys(this).forEach(key => {
                if (typeof this[key]?.resetHistory === 'function') {
                    this[key].resetHistory();
                }
            });
        },
    };
}

/**
 * Cria um browser mockado do Puppeteer
  * @returns {object}
 */
function criarBrowserMock() {
    const pagina = criarPaginaMock();

    return {
        newPage: sinon.stub().resolves(pagina),
        pages: sinon.stub().resolves([pagina]),
        close: sinon.stub().resolves(),
        isConnected: sinon.stub().returns(true),
        version: sinon.stub().resolves('Chrome/120.0.0.0'),
        wsEndpoint: sinon.stub().returns(`ws://localhost:${process.env.CHROME_PROXY_PORT || 9224}`),

        // Referência à página para asserções
        _pagina: pagina,

        // Helpers
        limpar: function () {
            this.newPage.resetHistory();
            this.pages.resetHistory();
            this.close.resetHistory();
            this._pagina.limpar();
        },
    };
}

/**
 * Cria um BrowserPoolManager mockado
  * @returns {object}
 */
function criarBrowserPoolMock() {
    const browser = criarBrowserMock();

    return {
        acquire: sinon.stub().resolves(browser),
        release: sinon.stub().resolves(),
        closeAll: sinon.stub().resolves(),
        getStats: sinon.stub().returns({
            total: 1,
            available: 1,
            inUse: 0,
        }),

        // Referência ao browser
        _browser: browser,

        // Helpers
        limpar: function () {
            this.acquire.resetHistory();
            this.release.resetHistory();
            this.closeAll.resetHistory();
            this._browser.limpar();
        },
    };
}

/**
 * Cria um ConnectionOrchestrator mockado
  * @returns {object}
 */
function criarConnectionOrchestratorMock() {
    return {
        connect: sinon.stub().resolves(criarBrowserMock()),
        disconnect: sinon.stub().resolves(),
        isConnected: sinon.stub().returns(true),
        getMode: sinon.stub().returns('wsEndpoint'),

        limpar: function () {
            this.connect.resetHistory();
            this.disconnect.resetHistory();
        },
    };
}

export { criarPaginaMock, criarBrowserMock, criarBrowserPoolMock, criarConnectionOrchestratorMock };
