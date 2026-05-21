// @ts-check
/**
 * Porta canônica de configuração BYOK para consumidores fora da camada SDK.
 *
 * Runtime/terminal/agent não devem importar `#copilot/sdk/*` diretamente. Este módulo expõe apenas a superfície de
 * configuração segura necessária para ativar providers customizados no contrato oficial do SDK.
 *
 * @module copilot/config/byok
 */

export {
    BYOK_ENV_KEYS,
    BYOK_SECRET_ENV_KEYS,
    buildConfiguredByokModelListHandler,
    readConfiguredByokModelsFromEnv,
    readConfiguredByokProfileSummaries,
    readConfiguredByokProfilesFromEnv,
    readConfiguredByokState,
    readConfiguredByokSummary,
    redactProviderConfig,
    resolveConfiguredByokSessionOverrides,
} from './sdk-config-port.js';
