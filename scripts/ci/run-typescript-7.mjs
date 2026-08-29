#!/usr/bin/env node
// @ts-check
/**
 * Entrada determinística do compilador TypeScript 7 canônico.
 *
 * `typescript` é a única autoridade TypeScript do workspace. Resolvemos seu package root explicitamente para manter o
 * gate independente de PATH/global installs e impedir que um rebuild selecione outro compilador por acidente.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.resolve('typescript/package.json')));
await import(pathToFileURL(path.join(packageRoot, 'lib', 'tsc.js')).href);
