// @ts-check
/**
 * Structural HTTP fakes for MCP adapter tests.
 *
 * These deliberately model only the protocol surface consumed by the MCP HTTP adapters. Tests that need a real Node
 * socket/server continue to use node:http directly; adapter unit tests should not cast plain records to
 * ServerResponse.
 */

/**
 * @typedef {{
 *     method: string;
 *     headers: Record<string, string>;
 *     httpVersionMajor: number;
 * }} FakeMcpHttpRequest
 *
 * @typedef {{
 *     headersSent: boolean;
 *     writableEnded: boolean;
 *     statusCode: number;
 *     body: string;
 *     headers: Record<string, string>;
 *     setHeader: (name: string, value: string | number | readonly string[]) => void;
 *     write: (chunk: unknown) => void;
 *     end: () => void;
 * }} FakeMcpHttpResponse
 *
 * @typedef {{ error: string; error_description: string }} FakeMcpTransportError
 *
 * @typedef {{ statusCode: number; error: FakeMcpTransportError }} CapturedMcpTransportError
 *
 * @typedef {{
 *     handleRequest?: (req: FakeMcpHttpRequest, res: FakeMcpHttpResponse, body?: unknown) => Promise<void> | void;
 *     close?: () => Promise<void> | void;
 *     send?: (message: unknown) => Promise<unknown> | unknown;
 * }} FakeMcpTransportHandlers
 */

/**
 * @param {string} method
 * @param {Record<string, string>} [headers]
 * @returns {FakeMcpHttpRequest}
 */
export function fakeMcpRequest(method, headers = {}) {
    return { method, headers: { ...headers }, httpVersionMajor: 1 };
}

/** @returns {FakeMcpHttpResponse} */
export function fakeMcpResponse() {
    const response = {
        headersSent: false,
        writableEnded: false,
        statusCode: 0,
        body: '',
        /** @type {Record<string, string>} */
        headers: {},
        /** @param {string} name @param {string | number | readonly string[]} value */
        setHeader(name, value) {
            response.headers[String(name).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        },
        /** @param {unknown} chunk */
        write(chunk) {
            response.headersSent = true;
            response.body += String(chunk);
        },
        end() {
            response.writableEnded = true;
        },
    };
    return response;
}

/**
 * @param {FakeMcpHttpRequest} req
 * @param {string} name
 * @returns {string | undefined}
 */
export function readFakeMcpHeader(req, name) {
    return req.headers[name.toLowerCase()];
}

/**
 * @param {CapturedMcpTransportError[]} errors
 * @returns {(res: FakeMcpHttpResponse, statusCode: number, error: FakeMcpTransportError) => void}
 */
export function captureMcpTransportErrors(errors) {
    return (_res, statusCode, error) => {
        errors.push({ statusCode, error });
    };
}

/**
 * Allocate a typed error sink together with the callback expected by the router.
 */
export function createMcpTransportErrorCollector() {
    /** @type {CapturedMcpTransportError[]} */
    const errors = [];
    return { errors, writeTransportError: captureMcpTransportErrors(errors) };
}

/**
 * @param {FakeMcpTransportHandlers} [handlers]
 */
export function fakeMcpTransport(handlers = {}) {
    return {
        /** @param {FakeMcpHttpRequest} req @param {FakeMcpHttpResponse} res @param {unknown} [body] */
        async handleRequest(req, res, body) {
            await handlers.handleRequest?.(req, res, body);
        },
        async close() {
            await handlers.close?.();
        },
        /** @param {unknown} message */
        async send(message) {
            return handlers.send?.(message);
        },
    };
}
