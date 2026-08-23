// @ts-check
/**
 * Fail-closed runtime network facade.
 *
 * This is the only network surface projected through `infra/public`. Callers cannot inject DNS resolvers, authorize
 * private/local addresses, or otherwise weaken the socket-bound SSRF policy. White-box policy testing remains owned by
 * `infra/platform/network` and is never projected through the runtime membrane.
 * @module copilot/infra/platform/network/runtime/service
 */
import {
    assertPublicHttpUrl as assertWithPolicy,
    evaluatePublicHttpUrlPolicy as evaluateWithPolicy,
    fetchPublicHttp as fetchWithPolicy,
    validateUrlString as validateStringWithPolicy,
    validateUrl as validateWithPolicy,
} from '../index.js';

/** @param {URL} url */
export function validateUrl(url) {
    return validateWithPolicy(url);
}

/** @param {string} input */
export function validateUrlString(input) {
    return validateStringWithPolicy(input);
}

/** @param {string} input */
export function assertPublicHttpUrl(input) {
    return assertWithPolicy(input);
}

/** @param {{input:string;maxRedirects?:number}} options */
export function evaluatePublicHttpUrlPolicy(options) {
    return evaluateWithPolicy({
        input: options.input,
        ...(options.maxRedirects === undefined ? {} : { maxRedirects: options.maxRedirects }),
    });
}

/**
 * @param {string|URL} input
 * @param {{method?:string;headers?:Record<string,string>;body?:string|Uint8Array;signal?:AbortSignal}} [init]
 */
export function fetchPublicHttp(input, init = {}) {
    return fetchWithPolicy(input, init);
}
