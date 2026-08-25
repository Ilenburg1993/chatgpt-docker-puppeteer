// @ts-check
/** Testing-only membrane for Cloudflare managed-process supervision and diagnostics. */

export { createCloudflareManagedProcessController } from '../cli-process.js';
export {
    isCloudflaredMetricsBindErrorLine,
    isCloudflaredOriginErrorLine,
    isCloudflaredTunnelTransportErrorLine,
} from '../diagnostics.js';
