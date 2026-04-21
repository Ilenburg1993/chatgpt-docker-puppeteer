// @ts-check
/**
 * @module copilot/presentation/runtime-request
 * @file Resolução canônica de `runtimeId` e dependências do runtime por requisição HTTP.
 *
 *   Esta camada transforma a preparação multi-agent de `runtime-registry` + `presentation/agent-runtime` em um caminho
 *   operacional real para bordas HTTP, sem forçar cada router a reimplementar parsing de `query/header/body`.
 */

import { buildDefaultCopilotApiRouteDeps, buildDefaultSdkRouteSharedDeps } from './runtime-route-deps.js';
import { pickRuntimeId } from './runtime-targeting.js';

/**
 * @typedef {import('express').Request} ExpressRequest
 */

/**
 * Lê o `runtimeId` solicitado em ordem de precedência canônica.
 *
 * Ordem atual:
 *
 * 1. `?runtimeId=`
 * 2. `?runtime=`
 * 3. `x-agent-runtime-id`
 * 4. `body.runtimeId`
 * 5. `params.runtimeId`
 *
 * @param {ExpressRequest} req
 * @returns {string | null}
 */
export function resolveRequestedRuntimeId(req) {
    return pickRuntimeId(
        req.query?.['runtimeId'],
        req.query?.['runtime'],
        req.headers['x-agent-runtime-id'],
        req.body?.runtimeId,
        req.params?.runtimeId,
    );
}

/**
 * Resolve as dependências canônicas do `copilot-api` para a requisição atual.
 *
 * @param {ExpressRequest} req
 * @returns {ReturnType<typeof buildDefaultCopilotApiRouteDeps>}
 */
export function resolveCopilotApiRouteDeps(req) {
    return buildDefaultCopilotApiRouteDeps(resolveRequestedRuntimeId(req));
}

/**
 * Resolve as dependências canônicas das rotas `/sdk/*` para a requisição atual.
 *
 * @param {ExpressRequest} req
 * @returns {ReturnType<typeof buildDefaultSdkRouteSharedDeps>}
 */
export function resolveSdkRouteSharedDeps(req) {
    return buildDefaultSdkRouteSharedDeps(resolveRequestedRuntimeId(req));
}
