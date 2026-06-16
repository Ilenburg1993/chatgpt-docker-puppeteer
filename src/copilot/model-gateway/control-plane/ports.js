// @ts-check
/**
 * Runtime-validated ports for the Model Gateway application layer.
 *
 * These contracts keep catalog, session, secret and persistence adapters explicit without coupling the control plane to
 * terminal, SDK or a concrete database implementation.
 *
 * @module copilot/model-gateway/control-plane/ports
 */

/**
 * @typedef {{
 *   readSnapshot?: () => Promise<Record<string, any>>;
 *   readRoutingSnapshot?: (options?: { includeImportRuns?: boolean }) => Promise<Record<string, any>>;
 * }} ModelGatewayCatalogReadPort
 */

/**
 * @typedef {{
 *   filePath: string;
 *   readSnapshot: () => Promise<Record<string, any>>;
 *   writeSnapshot: (snapshot: Record<string, unknown>) => Promise<unknown>;
 * }} ModelGatewayCatalogWritePort
 */

/**
 * @typedef {{
 *   readSdkSessionHandoffRecord: (operationId: string) => Promise<Record<string, unknown> | null>;
 *   writeSdkSessionHandoffRecords: (records: Record<string, unknown>[]) => Promise<unknown>;
 *   writeSdkSessionConfirmationRecords: (records: Record<string, unknown>[]) => Promise<unknown>;
 * }} ModelGatewayOperationStorePort
 */

/**
 * @typedef {{
 *   get: (ref: string) => string | undefined;
 *   has: (ref: string) => boolean;
 *   describe: (ref: string) => Record<string, unknown>;
 * }} ModelGatewaySecretRegistryPort
 */

/**
 * @typedef {{
 *   reattach: (route: Record<string, unknown>) => Promise<import('#copilot/sdk/types').CopilotSession>;
 *   verify: (
 *     session: import('#copilot/sdk/types').CopilotSession,
 *     route: Record<string, unknown>,
 *   ) => Promise<boolean>;
 *   commit: (
 *     session: import('#copilot/sdk/types').CopilotSession,
 *     route: Record<string, unknown>,
 *   ) => Promise<void>;
 * }} ModelGatewaySessionRoutePort
 */

/**
 * @typedef {{
 *   list: () => Record<string, unknown>[];
 *   get: (name: string) => Record<string, unknown> | null;
 *   getActive: () => Record<string, unknown> | null;
 * }} ModelGatewayProviderProfileStorePort
 */

/**
 * @param {unknown} value
 * @param {string} portName
 * @returns {Record<string, unknown>}
 */
function portRecord(value, portName) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`MODEL_GATEWAY_PORT_INVALID: port=${portName} expected=object`);
    }
    return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {Record<string, unknown>} port
 * @param {string} portName
 * @param {string[]} methods
 */
function requireMethods(port, portName, methods) {
    const missing = methods.filter((method) => typeof port[method] !== 'function');
    if (missing.length > 0) {
        throw new TypeError(`MODEL_GATEWAY_PORT_INVALID: port=${portName} missing=${missing.join(',')}`);
    }
}

/**
 * @param {unknown} value
 * @returns {ModelGatewayCatalogReadPort}
 */
export function assertModelGatewayCatalogReadPort(value) {
    const port = portRecord(value, 'catalog.read');
    if (typeof port['readSnapshot'] !== 'function' && typeof port['readRoutingSnapshot'] !== 'function') {
        throw new TypeError(
            'MODEL_GATEWAY_PORT_INVALID: port=catalog.read missing=readSnapshot|readRoutingSnapshot',
        );
    }
    return /** @type {ModelGatewayCatalogReadPort} */ (value);
}

/**
 * @param {unknown} value
 * @returns {ModelGatewayCatalogWritePort}
 */
export function assertModelGatewayCatalogWritePort(value) {
    const port = portRecord(value, 'catalog.write');
    requireMethods(port, 'catalog.write', ['readSnapshot', 'writeSnapshot']);
    if (typeof port['filePath'] !== 'string' || !port['filePath']) {
        throw new TypeError('MODEL_GATEWAY_PORT_INVALID: port=catalog.write missing=filePath');
    }
    return /** @type {ModelGatewayCatalogWritePort} */ (value);
}

/**
 * @param {unknown} value
 * @returns {ModelGatewayOperationStorePort}
 */
export function assertModelGatewayOperationStorePort(value) {
    const port = portRecord(value, 'persistence.operations');
    requireMethods(port, 'persistence.operations', [
        'readSdkSessionHandoffRecord',
        'writeSdkSessionHandoffRecords',
        'writeSdkSessionConfirmationRecords',
    ]);
    return /** @type {ModelGatewayOperationStorePort} */ (value);
}

/**
 * @param {unknown} value
 * @returns {ModelGatewaySecretRegistryPort}
 */
export function assertModelGatewaySecretRegistryPort(value) {
    const port = portRecord(value, 'secrets.registry');
    requireMethods(port, 'secrets.registry', ['get', 'has', 'describe']);
    return /** @type {ModelGatewaySecretRegistryPort} */ (value);
}

/**
 * @param {unknown} value
 * @returns {ModelGatewaySessionRoutePort}
 */
export function assertModelGatewaySessionRoutePort(value) {
    const port = portRecord(value, 'session.route');
    requireMethods(port, 'session.route', ['reattach', 'verify', 'commit']);
    return /** @type {ModelGatewaySessionRoutePort} */ (value);
}

/**
 * @param {unknown} value
 * @returns {ModelGatewayProviderProfileStorePort}
 */
export function assertModelGatewayProviderProfileStorePort(value) {
    const port = portRecord(value, 'profiles.store');
    requireMethods(port, 'profiles.store', ['list', 'get', 'getActive']);
    return /** @type {ModelGatewayProviderProfileStorePort} */ (value);
}
