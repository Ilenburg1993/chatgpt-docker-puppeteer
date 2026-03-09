#!/usr/bin/env node
// @ts-check
import process from 'node:process';

const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
if (Number.isNaN(major) || major < 24) {
    console.error(`[ci] Node.js 24+ required. Current: ${process.version}`);
    process.exit(1);
}

console.log(`[ci] Node version OK: ${process.version}`);
