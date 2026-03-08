#!/usr/bin/env node
// @ts-check

/**
 * @file Proxy de compatibilidade para build.mjs
 * @deprecated Este script foi movido para scripts/build/build.mjs Este arquivo é um proxy temporário para manter
 *   compatibilidade.
 */

console.warn('⚠️  DEPRECATED: Este script foi movido para scripts/build/build.mjs');
console.warn('   Por favor, atualize suas referências.');
console.warn('   Este proxy será removido em breve.');

// Importa o script real
import('./build/build.mjs');
