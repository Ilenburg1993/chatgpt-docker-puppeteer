#!/usr/bin/env node
// @ts-check
import fs from 'fs/promises';
import path from 'path';

async function main() {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
        console.error('Usage: make-skill.js <name> [--root DIR]');
        process.exit(1);
    }

    const name = argv[0];
    const rootIndex = argv.indexOf('--root');
    const root = rootIndex !== -1 && argv[rootIndex + 1] ? path.resolve(argv[rootIndex + 1]) : process.cwd();
    // skills now live under .github/skills instead of .codex/skills
    const skillDir = path.join(root, '.github', 'skills', name);

    try {
        await fs.mkdir(skillDir, { recursive: true });
    } catch (err) {
        console.error('failed to create directory', skillDir, err);
        process.exit(1);
    }

    const template = `---
name: ${name}
user-invokable: true
description: "Description for ${name}"
---

# ${name}

## Overview

_TODO: escreva uma visão geral do skill._
`;

    const skillFile = path.join(skillDir, 'SKILL.md');
    await fs.writeFile(skillFile, template, 'utf8');

    // update package.json with alias
    const pkgPath = path.join(root, 'package.json');
    try {
        const pkgText = await fs.readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(pkgText);
        pkg.scripts = pkg.scripts || {};
        pkg.scripts[`audit:${name}`] = `echo \"run ${name} skill\"`;
        await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    } catch (err) {
        console.warn('unable to update package.json alias', /** @type {any} */ (err).message);
    }

    console.log(`skill ${name} created at ${skillDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
