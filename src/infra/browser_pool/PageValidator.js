// @ts-check
import { isDomainMatch } from '#core/domain_matcher';
import { log } from '#core/logger';

/**
 * Severity levels para validation issues.
 *
 * @readonly
 * @enum {string}
 */
const SEVERITY = {
    FATAL: 'FATAL', // Bloqueia allocation
    WARNING: 'WARNING', // Permite allocation com warning
};

/**
 * Issue types para categorização de problemas.
 *
 * @readonly
 * @enum {string}
 */
const ISSUE_TYPES = {
    PAGE_NULL: 'PAGE_NULL',
    PAGE_CLOSED: 'PAGE_CLOSED',
    PAGE_DISCONNECTED: 'PAGE_DISCONNECTED',
    DOMAIN_MISMATCH: 'DOMAIN_MISMATCH',
    DOM_NOT_READY: 'DOM_NOT_READY',
    EVALUATION_FAILED: 'EVALUATION_FAILED',
};

/**
 * Expected domains por target. Usado para validar que página está no domain correto.
 *
 * @type {Object<string, string>}
 * @readonly
 */
const EXPECTED_DOMAINS = {
    chatgpt: 'chatgpt.com',
    gemini: 'gemini.google.com',
    claude: 'claude.ai',
    openai: 'openai.com',
};

/**
 * PageValidator - Static utility para validação de páginas.
 *
 * Não mantém estado, todas as operações são stateless.
 */
class PageValidator {
    /**
     * Valida health de página ANTES de allocation.
     *
     * Executa 4 checks críticos:
     *
     * 1. Page alive (não null, não closed)
     * 2. Page connected (evaluate test)
     * 3. Target URL validation (domain match - optional)
     * 4. DOM readiness (document.readyState)
     *
     * @example
     *     const result = await PageValidator.validate(page, 'chatgpt');
     *     if (!result.valid) {
     *         throw new Error(`Page invalid: ${JSON.stringify(result.issues)}`);
     *     }
     *
     * @property {boolean} valid - true se pode alocar, false se bloqueado
     * @property {object[]} issues - Lista de problemas detectados
     * @property {number} timestamp - Timestamp da validação
     * @param {any} page - Puppeteer Page instance
     * @param {string} [target] - Target name (chatgpt, gemini, etc) para domain validation
     * @returns {Promise<any>} Validation result
     */
    static async validate(page, /** @type {string | null} */ target = null) {
        const startTime = Date.now();
        const issues = [];

        try {
            // ============================================
            // CHECK 1: Page Alive (Null/Closed)
            // ============================================
            if (!page) {
                issues.push({
                    type: ISSUE_TYPES.PAGE_NULL,
                    severity: SEVERITY.FATAL,
                    message: 'Page is null or undefined',
                });

                return { valid: false, issues, timestamp: Date.now(), duration: Date.now() - startTime };
            }

            if (page.isClosed && page.isClosed()) {
                issues.push({
                    type: ISSUE_TYPES.PAGE_CLOSED,
                    severity: SEVERITY.FATAL,
                    message: 'Page is closed',
                });

                return { valid: false, issues, timestamp: Date.now(), duration: Date.now() - startTime };
            }

            // ============================================
            // CHECK 2: Page Connected (Evaluate Test)
            // ============================================
            try {
                await page.evaluate(() => document.readyState);
            } catch (/** @type {any} */ _rawErr) {
                const err = /** @type {any} */ (_rawErr);
                issues.push({
                    type: ISSUE_TYPES.PAGE_DISCONNECTED,
                    severity: SEVERITY.FATAL,
                    message: 'Page disconnected or crashed',
                    error: err.message,
                });

                return { valid: false, issues, timestamp: Date.now(), duration: Date.now() - startTime };
            }

            // ============================================
            // CHECK 3: Target URL Validation (Optional)
            // ============================================
            if (target) {
                const currentUrl = page.url();
                const expectedDomain = EXPECTED_DOMAINS[target];

                if (expectedDomain) {
                    // Skip validation for about:blank (not navigated yet)
                    if (currentUrl !== 'about:blank' && !isDomainMatch(currentUrl, expectedDomain)) {
                        issues.push({
                            type: ISSUE_TYPES.DOMAIN_MISMATCH,
                            severity: SEVERITY.WARNING,
                            message: `Domain mismatch: expected ${expectedDomain}`,
                            expected: expectedDomain,
                            actual: currentUrl,
                        });
                    }
                }
            }

            // ============================================
            // CHECK 4: DOM Readiness
            // ============================================
            try {
                const readyState = await page.evaluate(() => document.readyState);

                if (readyState !== 'complete' && readyState !== 'interactive') {
                    issues.push({
                        type: ISSUE_TYPES.DOM_NOT_READY,
                        severity: SEVERITY.WARNING,
                        message: `DOM not ready: ${readyState}`,
                        readyState,
                    });
                }
            } catch (/** @type {any} */ _rawErr) {
                const err = /** @type {any} */ (_rawErr);
                issues.push({
                    type: ISSUE_TYPES.EVALUATION_FAILED,
                    severity: SEVERITY.WARNING,
                    message: 'Failed to evaluate document.readyState',
                    error: err.message,
                });
            }

            // ============================================
            // RESULT
            // ============================================
            const hasFatalIssues = issues.some((issue) => issue.severity === SEVERITY.FATAL);

            return {
                valid: !hasFatalIssues,
                issues,
                timestamp: Date.now(),
                duration: Date.now() - startTime,
            };
        } catch (/** @type {any} */ _rawErr) {
            const err = /** @type {any} */ (_rawErr);
            log('ERROR', `[PageValidator] Validation failed: ${err.message}`);

            return {
                valid: false,
                issues: [
                    {
                        type: ISSUE_TYPES.EVALUATION_FAILED,
                        severity: SEVERITY.FATAL,
                        message: 'Validation process failed',
                        error: err.message,
                    },
                ],
                timestamp: Date.now(),
                duration: Date.now() - startTime,
            };
        }
    }

    /**
     * Quick validation (apenas checks críticos). Mais rápido que validate() full, usado para hot-path.
     *
     * @param {any} page - Puppeteer Page
     * @returns {Promise<boolean>} true se válido, false se inválido
     */
    static async quickValidate(page) {
        if (!page || (page.isClosed && page.isClosed())) {
            return false;
        }

        try {
            await page.evaluate(() => 1 + 1);
            return true;
        } catch (/** @type {any} */ _) {
            return false;
        }
    }

    /**
     * Retorna expected domain para target.
     *
     * @param {string} target - Target name
     * @returns {string | null} Expected domain ou null se não mapeado
     */
    static getExpectedDomain(target) {
        return EXPECTED_DOMAINS[target] || null;
    }
}

export { EXPECTED_DOMAINS, ISSUE_TYPES, PageValidator, SEVERITY };
