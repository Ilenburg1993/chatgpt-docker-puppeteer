/**
 * Type declarations for ChromeProxyService
 *
 * @module chromeProxyService
 */

import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

export interface ChromeProxyServiceConfig {
    PROXY_PORT?: number;
    CHROME_HOST?: string;
    CHROME_PORT?: number;
    PROXY_BIND?: string;
    PUBLIC_IP?: string | null;
    LOG_LEVEL?: string;
    ALLOWED_ORIGINS?: string[];
    AUTO_HANDLE_SIGNALS?: boolean;
}

export interface CircuitBreakerState {
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failures: number;
    nextAttempt: number;
}

export interface ProxyStats {
    httpRequests: number;
    wsUpgrades: number;
    errors: number;
    startTime: number;
    cacheHits: number;
    cacheMisses: number;
}

/**
 * Chrome Proxy Service - Production-grade HTTP/WebSocket proxy
 */
export default class ChromeProxyService {
    constructor(config?: ChromeProxyServiceConfig);

    /**
     * Start the proxy server
     */
    start(): Promise<void>;

    /**
     * Stop the proxy server gracefully
     */
    stop(): Promise<void>;

    /**
     * Handle HTTP request proxying
     */
    handleHTTPRequest(req: IncomingMessage, res: ServerResponse): void;

    /**
     * Handle WebSocket upgrade
     */
    handleWebSocketUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void;

    /**
     * Rewrite WebSocket URL for proxy
     */
    rewriteWebSocketURL(data: string, hostFallback?: string | null): string;
}
