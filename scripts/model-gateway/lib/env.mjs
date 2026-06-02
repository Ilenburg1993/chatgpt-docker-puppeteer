import { config as loadDotenv } from 'dotenv';

export function loadModelGatewayDotenv() {
    loadDotenv({ path: '.env.local', override: false, quiet: true });
    loadDotenv({ path: '.env', override: false, quiet: true });
}
