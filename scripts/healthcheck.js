#!/usr/bin/env node
// @ts-check

/**
 * @fileoverview Proxy de compatibilidade para healthcheck.js
 * @deprecated Este script foi movido para scripts/health/healthcheck.js
 * Este arquivo é um proxy temporário para manter compatibilidade.
 */

console.warn('⚠️  DEPRECATED: Este script foi movido para scripts/health/healthcheck.js');
console.warn('   Por favor, atualize suas referências.');
console.warn('   Este proxy será removido em breve.');

// Importa o script real
import('./health/healthcheck.js');
