// @ts-check
/** @module copilot/infra/platform/network/runtime */
export { IO_URL_MAX_REDIRECTS, PublicNetworkPolicyError, isPrivateIp } from '../index.js';
export {
    assertPublicHttpUrl,
    evaluatePublicHttpUrlPolicy,
    fetchPublicHttp,
    validateUrl,
    validateUrlString,
} from './service.js';
