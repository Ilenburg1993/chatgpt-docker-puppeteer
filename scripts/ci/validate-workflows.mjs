#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const workflowsDir = path.resolve('.github/workflows');
if (!fs.existsSync(workflowsDir)) {
    console.error('[ci] .github/workflows directory not found.');
    process.exit(1);
}

const files = fs.readdirSync(workflowsDir).filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));

if (files.length === 0) {
    console.error('[ci] No workflow files found.');
    process.exit(1);
}

for (const file of files) {
    const fullPath = path.join(workflowsDir, file);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed = yaml.load(raw);

    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`[ci] Invalid YAML object in ${file}`);
    }

    if (!parsed.name) {
        throw new Error(`[ci] Missing required field 'name' in ${file}`);
    }

    if (!parsed.on) {
        throw new Error(`[ci] Missing required field 'on' in ${file}`);
    }

    if (!parsed.jobs || Object.keys(parsed.jobs).length === 0) {
        throw new Error(`[ci] Missing required field 'jobs' in ${file}`);
    }
}

console.log(`[ci] Workflow validation OK (${files.length} files)`);
