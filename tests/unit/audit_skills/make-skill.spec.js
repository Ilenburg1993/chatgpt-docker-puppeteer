// @ts-check
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// the script uses cwd and --root so we can run in a tmpdir

test('make-skill creates directory and package alias', async t => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skilltest-'));
    // create a minimal package.json so alias update works
    const pkgPath = path.join(tmp, 'package.json');
    await fs.writeFile(pkgPath, JSON.stringify({ name: 'tmp', scripts: {} }, null, 2));

    const script = path.resolve('scripts/audit/make-skill.js');
    execSync(`node ${script} myskill --root ${tmp}`, { cwd: tmp });

    const skillPath = path.join(tmp, '.github/skills/myskill/SKILL.md');
    const stat = await fs.stat(skillPath);
    assert.ok(stat.isFile(), 'SKILL.md should exist');

    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    assert.equal(pkg.scripts['audit:myskill'], 'echo "run myskill skill"');
});
