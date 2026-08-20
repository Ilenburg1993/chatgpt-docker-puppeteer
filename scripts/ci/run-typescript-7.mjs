#!/usr/bin/env node
// @ts-check
/**
 * Entrada determinística do compilador nativo TypeScript 7.
 *
 * O pacote `typescript` na raiz permanece temporariamente em TS6 para a faixa suportada pelo typescript-eslint. Por
 * isso, não dependemos do symlink concorrente `node_modules/.bin/tsc` para selecionar o compilador canônico.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.resolve('@typescript/native/package.json')));
await import(pathToFileURL(path.join(packageRoot, 'lib', 'tsc.js')).href);
