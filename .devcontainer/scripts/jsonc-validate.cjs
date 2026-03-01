#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireFromHere = createRequire(__filename);
const DEFAULT_SYSTEM_JSONC_PARSER = '/usr/local/share/npm-global/lib/node_modules/jsonc-parser';
const DEFAULT_GLOBAL_JSONC_PARSER = '/home/node/.npm-global/lib/node_modules/jsonc-parser';

function usage() {
    console.error('Usage: jsonc-validate <file.jsonc>');
    process.exit(64);
}

function loadJsoncParser() {
    const candidates = [];
    if (process.env.JSONC_PARSER_MODULE_PATH) {
        candidates.push(process.env.JSONC_PARSER_MODULE_PATH);
    }
    candidates.push(DEFAULT_SYSTEM_JSONC_PARSER, DEFAULT_GLOBAL_JSONC_PARSER, 'jsonc-parser');

    for (const candidate of candidates) {
        try {
            return requireFromHere(candidate);
        } catch {
            // Try next candidate.
        }
    }

    console.error('[jsonc-validate] jsonc-parser not found.');
    console.error('[jsonc-validate] Expected one of:');
    for (const candidate of candidates) {
        console.error(`  - ${candidate}`);
    }
    console.error('[jsonc-validate] Rebuild the DevContainer or install jsonc-parser.');
    process.exit(69);
}

function offsetToLineCol(text, offset) {
    const safeOffset = Math.max(0, Math.min(Number(offset) || 0, text.length));
    const slice = text.slice(0, safeOffset);
    const lines = slice.split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;
    return { line, column };
}

function main() {
    const fileArg = process.argv[2];
    if (!fileArg || fileArg === '--help' || fileArg === '-h') {
        usage();
    }

    const filePath = path.resolve(process.cwd(), fileArg);
    if (!fs.existsSync(filePath)) {
        console.error(`[jsonc-validate] File not found: ${filePath}`);
        process.exit(66);
    }

    const text = fs.readFileSync(filePath, 'utf8');
    const { parse, printParseErrorCode } = loadJsoncParser();
    const errors = [];

    parse(text, errors, {
        allowTrailingComma: true,
        disallowComments: false,
    });

    if (errors.length === 0) {
        console.log(`[jsonc-validate] OK: ${filePath}`);
        return;
    }

    console.error(`[jsonc-validate] Invalid JSONC: ${filePath}`);
    for (const err of errors) {
        const loc = offsetToLineCol(text, err.offset);
        const code = typeof printParseErrorCode === 'function' ? printParseErrorCode(err.error) : String(err.error);
        console.error(`- ${code} at ${loc.line}:${loc.column}`);
    }
    process.exit(65);
}

main();
