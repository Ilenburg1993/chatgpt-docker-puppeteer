#!/usr/bin/env node

/**
 * @fileoverview Proxy de compatibilidade para setup.sh
 * @deprecated Este script foi movido para scripts/setup/setup.sh
 * Este arquivo é um proxy temporário para manter compatibilidade.
 */

console.warn("⚠️  DEPRECATED: Este script foi movido para scripts/setup/setup.sh");
console.warn("   Por favor, atualize suas referências.");
console.warn("   Este proxy será removido em breve.");

// Executa o script real
import { spawn } from 'child_process';

const child = spawn('bash', ['./scripts/setup/setup.sh'], { stdio: 'inherit' });

child.on('error', (err) => {
  console.error('Erro ao executar o script:', err);
});

child.on('close', (code) => {
  process.exit(code);
});
