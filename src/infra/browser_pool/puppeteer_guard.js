// @ts-check - Type checking rigoroso habilitado (arquivo core)
/**
 * ============================================================================
 * Puppeteer Launch Guard — Architectural Enforcement Layer
 * ============================================================================
 *
 * OBJETIVO
 * --------
 * Impedir, em tempo de execução, qualquer uso de `puppeteer.launch()`
 * dentro do sistema, reforçando a decisão arquitetural de:
 *
 *   • Chrome externo
 *   • Conexão exclusiva via `puppeteer.connect()`
 *   • Ciclo de vida do browser fora do Node.js
 *
 * Este módulo transforma uma convenção de projeto em uma LEI TÉCNICA.
 *
 * ----------------------------------------------------------------------------
 * CONTEXTO ARQUITETURAL
 * ---------------------
 * - O sistema opera exclusivamente em modo "external browser"
 * - Chrome é iniciado fora do container / processo Node
 * - Puppeteer atua APENAS como cliente CDP
 *
 * Consequência direta:
 * --------------------
 * - `puppeteer.launch()` é semanticamente inválido
 * - Qualquer chamada indica regressão arquitetural
 *
 * ----------------------------------------------------------------------------
 * COMPORTAMENTO
 * -------------
 * - Se PUPPETEER_LOCAL_LAUNCH_DISABLED !== 'true' → NO-OP (não interfere)
 * - Se puppeteer-core não estiver carregado → NO-OP (ambiente parcial)
 * - Se `launch` existir → substitui por função que lança erro fatal
 *
 * ----------------------------------------------------------------------------
 * PROPRIEDADES
 * ------------
 * ✔ Seguro para require múltiplo (idempotente)
 * ✔ Não depende de ordem exata de imports
 * ✔ Não afeta testes que não carregam puppeteer-core
 * ✔ Erro explícito, legível e auditável
 *
 * ----------------------------------------------------------------------------
 * ATIVAÇÃO
 * --------
 * Exportação automática por efeito colateral.
 * Basta importar este módulo UMA vez, cedo no boot.
 *
 * Exemplo:
 *   import './infra/browser_pool/puppeteer_guard.js';
 *
 * ============================================================================
 */

/**
 * Mensagem única e canônica de violação arquitetural.
 * Centralizada para facilitar auditoria e grep.
 */
const ARCH_VIOLATION_MESSAGE =
    '[ARCHITECTURE VIOLATION] puppeteer.launch() is forbidden.\n' +
    'This system uses an EXTERNAL Chrome instance exclusively.\n' +
    'Use puppeteer.connect() with a remote debugging endpoint.\n' +
    'If you believe this is necessary, the architecture must be revised — not bypassed.';

/**
 * Flag de ativação explícita.
 * Sem essa flag, o módulo é completamente inerte.
 */
const isLaunchDisabled = process.env.PUPPETEER_LOCAL_LAUNCH_DISABLED === 'true';

let active = false;
let guarded = false;
let originalLaunch = null;

if (isLaunchDisabled) {
    // Arquitetura está em modo restritivo — aplica o guard
    active = true;

    /**
     * Tentativa defensiva de carregar puppeteer-core.
     * Não falha se não estiver presente (ambientes parciais, testes, lint, etc).
     */
    let puppeteer = null;
    try {
        puppeteer = await import('puppeteer-core');
        // handle default export: puppeteer-core might export via default
        if (puppeteer.default) puppeteer = puppeteer.default;
    } catch (_) {
        // puppeteer-core não carregado — ambiente ainda não o requer
    }

    /**
     * Aplica o guard apenas se `launch` existir e for função.
     * Isso cobre:
     * - puppeteer-core
     * - puppeteer-extra (que reexporta launch)
     */
    if (puppeteer && typeof puppeteer.launch === 'function') {
        originalLaunch = puppeteer.launch;

        /**
         * Substituição explícita.
         * NÃO chama o original.
         * NÃO tenta fallback.
         * Falha de forma inequívoca.
         */
        /** @type {typeof import('puppeteer-core')} */ (puppeteer).launch = function forbiddenLaunch() {
            const error = new Error(ARCH_VIOLATION_MESSAGE);

            // Metadados úteis para forensics / logs estruturados
            error.code = 'ARCH_FORBIDDEN_PUPPETEER_LAUNCH';
            error.originalFunction = 'puppeteer.launch';
            error.replacedBy = 'puppeteer.connect';

            throw error;
        };

        /**
         * Congela a propriedade para impedir redefinição posterior.
         * (best-effort: não falha se não for possível)
         */
        try {
            Object.defineProperty(puppeteer, 'launch', {
                configurable: false,
                writable: false
            });
        } catch (_) {
            // Ambiente não permite redefinir property — ignora
        }

        guarded = true;
    }
}

export { active, guarded, originalLaunch };
