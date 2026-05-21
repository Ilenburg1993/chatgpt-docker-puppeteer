// @ts-check
/**
 * Side-effect import do entrypoint do terminal.
 *
 * Deve ser importado antes das demais dependências do bootstrap para que `.env.local` esteja disponível a qualquer
 * módulo que leia configuração durante avaliação estática.
 *
 * @module copilot/terminal/bootstrap-dotenv
 */

import { loadTerminalDotenvLocal } from './bootstrap-dotenv-loader.js';

loadTerminalDotenvLocal();
