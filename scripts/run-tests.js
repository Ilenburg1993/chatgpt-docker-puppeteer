#!/usr/bin/env node

/**
 * @fileoverview Proxy de compatibilidade para run-tests.js
 * @deprecated Este script foi movido para scripts/build/run-tests.js
 * Este arquivo é um proxy temporário para manter compatibilidade.
 */

console.warn('⚠️  DEPRECATED: Este script foi movido para scripts/build/run-tests.js');
console.warn('   Por favor, atualize suas referências.');
console.warn('   Este proxy será removido em breve.');

// Importa o script real
import('./build/run-tests.js');
