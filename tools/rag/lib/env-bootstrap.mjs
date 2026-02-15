import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const RAG_ENV_BOOTSTRAP_FLAG = '__RAG_ENV_BOOTSTRAPPED__';

function projectRootFromHere() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '../../../');
}

export function bootstrapRagEnv(options = {}) {
    const root = options.rootDir ? path.resolve(options.rootDir) : projectRootFromHere();
    const useGlobalFlag = options.useGlobalFlag !== false;
    const quiet = options.quiet !== false;

    if (useGlobalFlag && globalThis[RAG_ENV_BOOTSTRAP_FLAG]) {
        return { root, loaded: [] };
    }

    const envLocalPath = path.join(root, '.env.local');
    const envPath = path.join(root, '.env');
    const loaded = [];

    // Load sensitive/local overrides first, then defaults.
    if (fs.existsSync(envLocalPath)) {
        dotenv.config({ path: envLocalPath, quiet });
        loaded.push(envLocalPath);
    }
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, quiet });
        loaded.push(envPath);
    }

    if (useGlobalFlag) {
        globalThis[RAG_ENV_BOOTSTRAP_FLAG] = true;
    }

    return { root, loaded };
}

bootstrapRagEnv();
