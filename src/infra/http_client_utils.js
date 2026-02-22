// @ts-check - Type checking rigoroso habilitado

/**
 * @fileoverview Safe HTTP client utilities with guaranteed resource cleanup.
 * Prevents request handle leaks by ensuring proper destruction on timeout/error.
 *
 * Created to address P0 bug in boot_resilience_manager.js where http.get()
 * requests were not destroyed on timeout, leading to file descriptor exhaustion.
 *
 * @module infra/http_client_utils
 */

import http from 'node:http';
import https from 'node:https';

/**
 * Makes an HTTP/HTTPS request with guaranteed cleanup of resources.
 * Ensures request is destroyed on timeout, error, or completion.
 *
 * @param {string|URL} url - The URL to request
 * @param {Object} [options={}] - Request options
 * @param {number} [options.timeout=5000] - Timeout in milliseconds
 * @param {string} [options.method='GET'] - HTTP method
 * @param {Object} [options.headers] - Request headers
 * @param {*} [options.body] - Request body (for POST/PUT)
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>}
 * @throws {Error} If request fails or times out
 *
 * @example
 * const { statusCode, body } = await safeHttpRequest('http://localhost:9222/json/version', {
 *   timeout: 2000
 * });
 */
export async function safeHttpRequest(url, options = {}) {
    const { timeout = 5000, method = 'GET', headers = {}, body = null } = options;

    return new Promise((resolve, reject) => {
        let timeoutId = null;
        let requestCompleted = false;
        let request = null;

        // Cleanup function to destroy request and clear timeout
        const cleanup = () => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (request && !request.destroyed) {
                request.destroy();
            }
        };

        // Completion handler to prevent duplicate resolution
        const complete = fn => {
            if (!requestCompleted) {
                requestCompleted = true;
                cleanup();
                fn();
            }
        };

        // Set timeout
        timeoutId = setTimeout(() => {
            complete(() => {
                const error = new Error(`HTTP request timed out after ${timeout}ms`);
                error.code = 'ETIMEDOUT';
                error.url = String(url);
                reject(error);
            });
        }, timeout);

        // Determine protocol
        const urlObj = typeof url === 'string' ? new URL(url) : url;
        const client = urlObj.protocol === 'https:' ? https : http;

        // Make request
        const requestOptions = {
            method,
            headers,
            timeout, // Also set native timeout as backup
        };

        request = client.request(urlObj, requestOptions, response => {
            const chunks = [];

            response.on('data', chunk => {
                chunks.push(chunk);
            });

            response.on('end', () => {
                complete(() => {
                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body: Buffer.concat(chunks).toString('utf8'),
                    });
                });
            });

            response.on('error', err => {
                complete(() => reject(err));
            });
        });

        request.on('error', err => {
            complete(() => reject(err));
        });

        request.on('timeout', () => {
            complete(() => {
                const error = new Error(`HTTP request timed out after ${timeout}ms`);
                error.code = 'ETIMEDOUT';
                error.url = String(url);
                reject(error);
            });
        });

        // Send body if present
        if (body) {
            const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
            request.write(bodyStr);
        }

        request.end();
    });
}

/**
 * Checks if a URL is reachable via HTTP HEAD request.
 * Returns status code and latency.
 *
 * @param {string|URL} url - URL to check
 * @param {number} [timeout=5000] - Timeout in milliseconds
 * @returns {Promise<{ok: boolean, statusCode: number|string, latencyMs: number, error?: string}>}
 *
 * @example
 * const { ok, statusCode, latencyMs } = await checkUrlHealth('http://localhost:9222');
 * if (ok) {
 *   console.log(`Service is healthy (${latencyMs}ms)`);
 * }
 */
export async function checkUrlHealth(url, timeout = 5000) {
    const startTime = Date.now();

    try {
        const { statusCode } = await safeHttpRequest(url, {
            method: 'HEAD',
            timeout,
        });

        const latencyMs = Date.now() - startTime;

        return {
            ok: statusCode >= 200 && statusCode < 400,
            statusCode,
            latencyMs,
        };
    } catch (err) {
        const latencyMs = Date.now() - startTime;

        return {
            ok: false,
            statusCode: err.code || 'ERROR',
            latencyMs,
            error: err.message,
        };
    }
}

/**
 * Fetches JSON from a URL with automatic parsing.
 *
 * @param {string|URL} url - URL to fetch
 * @param {Object} [options] - Request options (see safeHttpRequest)
 * @returns {Promise<Object>} Parsed JSON response
 * @throws {Error} If request fails or JSON parsing fails
 *
 * @example
 * const version = await fetchJson('http://localhost:9222/json/version');
 * console.log(`Chrome version: ${version['Browser']}`);
 */
export async function fetchJson(url, options = {}) {
    const { body } = await safeHttpRequest(url, {
        ...options,
        headers: {
            Accept: 'application/json',
            ...options.headers,
        },
    });

    try {
        return JSON.parse(body);
    } catch (err) {
        const error = new Error(`Failed to parse JSON response: ${err.message}`);
        error.code = 'INVALID_JSON';
        error.body = body;
        throw error;
    }
}

/**
 * Retries an HTTP request with exponential backoff.
 *
 * @param {string|URL} url - URL to request
 * @param {Object} [options={}] - Request options
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 * @param {number} [options.backoffMs=100] - Base backoff delay in ms
 * @param {Function} [options.shouldRetry] - Function to determine if error is retryable
 * @returns {Promise<Object>} Response object
 *
 * @example
 * const response = await retryHttpRequest('http://unstable-service/api', {
 *   maxRetries: 5,
 *   backoffMs: 200,
 *   shouldRetry: (err) => err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED'
 * });
 */
export async function retryHttpRequest(url, options = {}) {
    const {
        maxRetries = 3,
        backoffMs = 100,
        shouldRetry = err => ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET'].includes(err.code),
        ...requestOptions
    } = options;

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await safeHttpRequest(url, requestOptions);
        } catch (err) {
            lastError = err;

            // Don't retry if this was the last attempt or error is not retryable
            if (attempt >= maxRetries || !shouldRetry(err)) {
                break;
            }

            // Exponential backoff
            const delay = Math.min(backoffMs * Math.pow(2, attempt), 5000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // All retries failed
    const error = new Error(`HTTP request failed after ${maxRetries + 1} attempts: ${lastError.message}`);
    error.code = 'MAX_RETRIES_EXCEEDED';
    error.lastError = lastError;
    error.attempts = maxRetries + 1;
    error.url = String(url);
    throw error;
}

/**
 * Polls a URL until it becomes healthy or timeout is reached.
 * Useful for waiting for services to start up.
 *
 * @param {string|URL} url - URL to poll
 * @param {Object} [options={}] - Polling options
 * @param {number} [options.maxWaitMs=30000] - Maximum time to wait
 * @param {number} [options.intervalMs=500] - Polling interval
 * @param {number} [options.requestTimeout=2000] - Timeout per request
 * @returns {Promise<boolean>} True if URL became healthy
 *
 * @example
 * const ready = await pollUntilHealthy('http://localhost:9222/json', {
 *   maxWaitMs: 10000,
 *   intervalMs: 500
 * });
 * if (ready) {
 *   console.log('Service is ready!');
 * }
 */
export async function pollUntilHealthy(url, options = {}) {
    const { maxWaitMs = 30000, intervalMs = 500, requestTimeout = 2000 } = options;

    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        try {
            const { ok } = await checkUrlHealth(url, requestTimeout);
            if (ok) {
                return true;
            }
        } catch (err) {
            // Continue polling on error
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return false;
}

/**
 * Makes multiple HTTP requests in parallel with proper cleanup.
 *
 * @param {Array<{url: string, options?: Object}>} requests - Array of request configs
 * @returns {Promise<Array<Object>>} Array of responses
 *
 * @example
 * const results = await batchHttpRequests([
 *   { url: 'http://localhost:9222/json/version' },
 *   { url: 'http://localhost:9222/json/list', options: { timeout: 3000 } }
 * ]);
 */
export async function batchHttpRequests(requests) {
    return Promise.all(requests.map(({ url, options = {} }) => safeHttpRequest(url, options)));
}
