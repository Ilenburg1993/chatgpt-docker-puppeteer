#!/usr/bin/env node
/**
 * Entry Point Proxy - Delega para src/main.js
 *
 * Este arquivo existe para compatibilidade com:
 *
 * - Campo "main" do package.json
 * - Docker CMD
 * - PM2 ecosystem.config.cjs
 * - Scripts legados
 *
 * @file index.js
 * @requires Node.js 24+ (ESM obrigatório)
 */

import { main } from '#main';

/**
 * Função principal que inicia a aplicação. Side-effects: Inicia o loop principal da aplicação.
 */
main();
