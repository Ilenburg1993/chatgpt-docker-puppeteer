import { config as loadDotenv } from 'dotenv';

export function loadModelGatewayDotenv() {
    if (process.env['MODEL_GATEWAY_LOAD_DOTENV'] === 'false') {
        return { loaded: false, skipped: true };
    }
    loadDotenv({ path: '.env.local', override: false, quiet: true });
    loadDotenv({ path: '.env', override: false, quiet: true });
    return { loaded: true, skipped: false };
}
