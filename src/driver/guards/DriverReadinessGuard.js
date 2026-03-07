// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { isDomainMatch } from '#core/domain_matcher';
import * as stabilizer from '#shared/page_stability/stabilizer';
import { Triage } from '../modules/triage.js';

/**
 * @typedef {import('#driver/core/BaseDriver').default} BaseDriver
 */

/**
 * Check types para readiness validation.
 * @readonly
 * @enum {string}
 */
const CHECK_TYPES = {
    PAGE_ALIVE: 'PAGE_ALIVE',
    PAGE_STABLE: 'PAGE_STABLE',
    TRIAGE_CLEAN: 'TRIAGE_CLEAN',
    DOMAIN_VALID: 'DOMAIN_VALID',
    SESSION_HEALTHY: 'SESSION_HEALTHY',
};

/**
 * Severity levels para validation issues.
 * @readonly
 * @enum {string}
 */
const SEVERITY = {
    FATAL: 'FATAL', // Bloqueia execução
    WARNING: 'WARNING', // Permite execução com log
    INFO: 'INFO', // Informativo apenas
};

/**
 * FATAL patterns detectados por Triage que bloqueiam execução.
 * @readonly
 * @type {string[]}
 */
const FATAL_TRIAGE_PATTERNS = ['CAPTCHA', 'LOGIN_REQUIRED', 'PAGE_ERROR', 'CRITICAL_DOM_ERROR'];

/**
 * DriverReadinessGuard - Valida readiness de driver antes de execute().
 *
 * Instância por driver, mantém estado entre validações.
 */
class DriverReadinessGuard {
    /**
     * Cria guard para driver.
     *
     * @param {BaseDriver} driver - Driver instance
     */
    constructor(driver) {
        if (!driver) {
            throw new Error('[DriverReadinessGuard] Driver is required');
        }

        this.driver = driver;
        this.triage = null;
        this.lastValidation = null;
        this.validationCount = 0;
    }

    /**
     * Valida readiness completo do driver.
     *
     * Executa 5 checks em sequência:
     * 1. Page alive
     * 2. Page stable (stabilizer)
     * 3. Triage scan
     * 4. Domain validation
     * 5. Session health
     *
     * @param {object} [options={}] - Validation options
     * @param {number} [options.stabilityTimeout=10000] - Stabilizer timeout
     * @param {boolean} [options.skipTriage=false] - Skip triage scan (fast mode)
     * @param {boolean} [options.skipSession=false] - Skip session health check
     *
     * @returns {Promise<any>} Validation result
     * @property {boolean} ready - true se pode executar
     * @property {object} checks - Status de cada check (pass/fail)
     * @property {Array<object>} issues - Lista de problemas detectados
     * @property {number} duration - Duração da validação (ms)
     *
     * @throws {Error} Se validation encontra FATAL issues
     */
    async validateReadiness(options = {}) {
        const startTime = Date.now();
        const opts = {
            stabilityTimeout: options.stabilityTimeout || 10000,
            skipTriage: options.skipTriage || false,
            skipSession: options.skipSession || false,
        };

        const checks = {
            [CHECK_TYPES.PAGE_ALIVE]: false,
            [CHECK_TYPES.PAGE_STABLE]: false,
            [CHECK_TYPES.TRIAGE_CLEAN]: false,
            [CHECK_TYPES.DOMAIN_VALID]: false,
            [CHECK_TYPES.SESSION_HEALTHY]: false,
        };

        const issues = [];

        try {
            this.validationCount++;

            // ============================================
            // CHECK 1: Page Alive
            // ============================================
            if (!this.driver.page) {
                issues.push({
                    check: CHECK_TYPES.PAGE_ALIVE,
                    severity: SEVERITY.FATAL,
                    message: 'Page is null',
                });

                throw new Error('Page is null');
            }

            if (this.driver.page.isClosed && this.driver.page.isClosed()) {
                issues.push({
                    check: CHECK_TYPES.PAGE_ALIVE,
                    severity: SEVERITY.FATAL,
                    message: 'Page is closed',
                });

                throw new Error('Page is closed');
            }

            checks[CHECK_TYPES.PAGE_ALIVE] = true;

            // ============================================
            // CHECK 2: Page Stable (Stabilizer)
            // ============================================
            try {
                const stabilityResult = /** @type {any} */ (
                    await stabilizer.waitForStability(
                        this.driver,
                        Number(opts.stabilityTimeout) || 10000,
                        this.driver.signal || null
                    )
                );

                if (!stabilityResult?.success) {
                    const reason = stabilityResult?.timeout ? 'timeout' : 'unstable';
                    issues.push({
                        check: CHECK_TYPES.PAGE_STABLE,
                        severity: SEVERITY.WARNING,
                        message: `Page not stable: ${reason}`,
                        details: stabilityResult,
                    });

                    log('WARN', `[DriverReadinessGuard] Page not stable: ${reason}`, this.driver.correlationId);
                } else {
                    checks[CHECK_TYPES.PAGE_STABLE] = true;
                }
            } catch (/** @type {any} */ stabilityErr) {
                issues.push({
                    check: CHECK_TYPES.PAGE_STABLE,
                    severity: SEVERITY.WARNING,
                    message: `Stability check failed: ${/** @type {any} */ (stabilityErr).message}`,
                });

                log(
                    'WARN',
                    `[DriverReadinessGuard] Stability check error: ${/** @type {any} */ (stabilityErr).message}`
                );
            }

            // ============================================
            // CHECK 3: Triage Scan (Diagnostics)
            // ============================================
            if (!opts.skipTriage) {
                try {
                    if (!this.triage) {
                        this.triage = new Triage(this.driver.page, this.driver.config.langCode || 'en');
                    }

                    const triageResult = /** @type {any} */ (await this.triage.diagnose());

                    if (triageResult.detected && triageResult.detected.length > 0) {
                        log(
                            'WARN',
                            `[DriverReadinessGuard] Triage detected issues: ${JSON.stringify(triageResult.detected)}`,
                            this.driver.correlationId
                        );

                        // Check for FATAL patterns
                        const hasFatal = triageResult.detected.some((/** @type {any} */ d) =>
                            FATAL_TRIAGE_PATTERNS.includes(d.type || d.pattern)
                        );

                        if (hasFatal) {
                            const fatalIssues = triageResult.detected.filter((/** @type {any} */ d) =>
                                FATAL_TRIAGE_PATTERNS.includes(d.type || d.pattern)
                            );

                            issues.push({
                                check: CHECK_TYPES.TRIAGE_CLEAN,
                                severity: SEVERITY.FATAL,
                                message: `Page has fatal issue: ${fatalIssues[0].type || fatalIssues[0].pattern}`,
                                details: fatalIssues,
                            });

                            throw new Error(`Triage FATAL: ${fatalIssues[0].type || fatalIssues[0].pattern}`);
                        }

                        // Non-fatal issues: Log warning but proceed
                        issues.push({
                            check: CHECK_TYPES.TRIAGE_CLEAN,
                            severity: SEVERITY.WARNING,
                            message: 'Triage detected non-fatal issues',
                            details: triageResult.detected,
                        });

                        if (this.driver.emit) {
                            this.driver.emit('READINESS_WARNING', {
                                check: CHECK_TYPES.TRIAGE_CLEAN,
                                issues: triageResult.detected,
                            });
                        }
                    } else {
                        checks[CHECK_TYPES.TRIAGE_CLEAN] = true;
                    }
                } catch (/** @type {any} */ triageErr) {
                    // Triage error itself is not blocking (unless FATAL pattern detected)
                    if (/** @type {any} */ (triageErr).message.startsWith('Triage FATAL:')) {
                        throw triageErr;
                    }

                    issues.push({
                        check: CHECK_TYPES.TRIAGE_CLEAN,
                        severity: SEVERITY.WARNING,
                        message: `Triage scan failed: ${/** @type {any} */ (triageErr).message}`,
                    });

                    log('WARN', `[DriverReadinessGuard] Triage error: ${/** @type {any} */ (triageErr).message}`);
                }
            } else {
                checks[CHECK_TYPES.TRIAGE_CLEAN] = true; // Skipped = pass
            }

            // ============================================
            // CHECK 4: Domain Validation
            // ============================================
            if (this.driver.config.expectedDomain) {
                const currentUrlRaw = this.driver.page.url ? this.driver.page.url() : '';
                const currentUrl = typeof currentUrlRaw === 'string' ? currentUrlRaw.trim() : '';

                // about:blank antes de navegação não é mismatch.
                if (currentUrl === 'about:blank') {
                    checks[CHECK_TYPES.DOMAIN_VALID] = true;
                } else if (!currentUrl) {
                    issues.push({
                        check: CHECK_TYPES.DOMAIN_VALID,
                        severity: SEVERITY.FATAL,
                        message: 'Domain validation failed: current URL is empty',
                        expected: this.driver.config.expectedDomain,
                        actual: currentUrl,
                    });

                    throw new Error(
                        `Domain validation failed: empty URL (expected ${this.driver.config.expectedDomain})`
                    );
                } else if (!isDomainMatch(currentUrl, this.driver.config.expectedDomain)) {
                    issues.push({
                        check: CHECK_TYPES.DOMAIN_VALID,
                        severity: SEVERITY.FATAL,
                        message: `Domain mismatch: expected ${this.driver.config.expectedDomain}`,
                        expected: this.driver.config.expectedDomain,
                        actual: currentUrl,
                    });

                    throw new Error(
                        `Domain mismatch: expected ${this.driver.config.expectedDomain}, got ${currentUrl}`
                    );
                } else {
                    checks[CHECK_TYPES.DOMAIN_VALID] = true;
                }
            } else {
                checks[CHECK_TYPES.DOMAIN_VALID] = true; // No expected domain = skip
            }

            // ============================================
            // CHECK 5: Session Health (Phase 2 - P1-U1)
            // ============================================
            if (!opts.skipSession && this.driver.sessionTracker) {
                try {
                    const sessionHealth = /** @type {any} */ (this.driver.sessionTracker.getSessionHealth());

                    // Check if session is DEGRADED or CRITICAL
                    const isDegraded = sessionHealth.level === 'DEGRADED' || sessionHealth.level === 'CRITICAL';

                    if (isDegraded) {
                        issues.push({
                            check: CHECK_TYPES.SESSION_HEALTHY,
                            severity: SEVERITY.WARNING,
                            message: `Session health ${sessionHealth.level}: score ${sessionHealth.score}`,
                            details: sessionHealth,
                        });

                        log(
                            'WARN',
                            `[DriverReadinessGuard] Session ${sessionHealth.level}: ${sessionHealth.score}`,
                            this.driver.correlationId
                        );

                        if (this.driver.emit) {
                            this.driver.emit('SESSION_HEALTH_DEGRADED', sessionHealth);
                        }
                    }

                    checks[CHECK_TYPES.SESSION_HEALTHY] = true;
                } catch (/** @type {any} */ sessionErr) {
                    issues.push({
                        check: CHECK_TYPES.SESSION_HEALTHY,
                        severity: SEVERITY.INFO,
                        message: `Session health check failed: ${/** @type {any} */ (sessionErr).message}`,
                    });
                }
            } else {
                checks[CHECK_TYPES.SESSION_HEALTHY] = true; // Skipped = pass
            }

            // ============================================
            // RESULT
            // ============================================
            const hasFatalIssues = issues.some(issue => issue.severity === SEVERITY.FATAL);

            const result = {
                ready: !hasFatalIssues,
                checks,
                issues,
                timestamp: Date.now(),
                duration: Date.now() - startTime,
                validationCount: this.validationCount,
            };

            this.lastValidation = result;

            log(
                'DEBUG',
                `[DriverReadinessGuard] Validation complete: ready=${result.ready}, issues=${issues.length}, duration=${result.duration}ms`,
                this.driver.correlationId
            );

            return result;
        } catch (/** @type {any} */ err) {
            // FATAL error during validation
            const result = {
                ready: false,
                checks,
                issues,
                timestamp: Date.now(),
                duration: Date.now() - startTime,
                validationCount: this.validationCount,
                error: /** @type {any} */ (err).message,
            };

            this.lastValidation = result;

            log(
                'ERROR',
                `[DriverReadinessGuard] Validation failed: ${/** @type {any} */ (err).message}`,
                this.driver.correlationId
            );

            throw err;
        }
    }

    /**
     * Quick validation (apenas checks críticos).
     *
     * Executa apenas: page alive + page stable (sem triage).
     * Mais rápido para hot-path.
     *
     * @returns {Promise<boolean>} true se ready, false se not ready
     */
    async quickValidate() {
        try {
            const result = await this.validateReadiness({
                skipTriage: true,
                skipSession: true,
                stabilityTimeout: 5000,
            });

            return /** @type {any} */ (result).ready;
        } catch (/** @type {any} */ _) {
            return false;
        }
    }

    /**
     * Retorna última validação executada.
     *
     * @returns {object|null} Last validation result
     */
    getLastValidation() {
        return this.lastValidation;
    }

    /**
     * Reset triage instance (força new scan).
     */
    resetTriage() {
        this.triage = null;
        log('DEBUG', '[DriverReadinessGuard] Triage instance reset');
    }
}

export { DriverReadinessGuard, CHECK_TYPES, SEVERITY, FATAL_TRIAGE_PATTERNS };
