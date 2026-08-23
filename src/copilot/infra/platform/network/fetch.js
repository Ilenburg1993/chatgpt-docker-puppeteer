// @ts-check
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { createPinnedPublicLookup } from './resolver.js';
import { assertPublicHttpUrl } from './url.js';

/** @param {import('node:http').IncomingHttpHeaders} raw */
function toHeaders(raw) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(raw)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.append(name, String(value));
    }
    return headers;
}

/**
 * Public HTTP(S) request with SSRF validation bound to socket DNS lookup. Redirects are never followed implicitly.
 * Returns the standard Fetch `Response` interface while keeping network authority in this module.
 * @param {string|URL} input
 * @param {{method?:string;headers?:Record<string,string>;body?:string|Uint8Array;signal?:AbortSignal}} [init]
 * @param {{allowPrivate?:boolean;resolver?:(hostname:string, options:{all:true;verbatim:true})=>Promise<{address:string;family:number}[]>}} [policy]
 * @returns {Promise<Response>}
 */
export function fetchPublicHttp(input, init = {}, policy = {}) {
    const url = assertPublicHttpUrl(String(input), { allowPrivate: policy.allowPrivate === true });
    const transport = url.protocol === 'https:' ? https : http;
    const lookup = createPinnedPublicLookup(policy);
    return new Promise((resolve, reject) => {
        const request = transport.request(
            url,
            {
                method: init.method ?? 'GET',
                headers: init.headers,
                lookup,
                ...(init.signal ? { signal: init.signal } : {}),
            },
            (incoming) => {
                const status = incoming.statusCode ?? 500;
                const noBody = init.method === 'HEAD' || status === 204 || status === 304;
                const body = noBody
                    ? null
                    : /** @type {ReadableStream<Uint8Array>} */ (/** @type {unknown} */ (Readable.toWeb(incoming)));
                const response = new Response(body, {
                    status,
                    statusText: incoming.statusMessage ?? '',
                    headers: toHeaders(incoming.headers),
                });
                resolve(response);
                if (noBody) incoming.resume();
            },
        );
        request.once('error', reject);
        if (init.body !== undefined) request.write(init.body);
        request.end();
    });
}
