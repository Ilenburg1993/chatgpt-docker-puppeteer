// @ts-check
import { execa } from 'execa';
import fs from 'node:fs';
import path from 'node:path';

if (process.env.FORCE_COLOR && process.env.NO_COLOR) {
    delete process.env.NO_COLOR;
}

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function fail(/** @type {string} */ msg) {
    console.error(`[check-env-local] FAIL: ${msg}`);
    process.exit(2);
}

function ok(/** @type {string} */ msg) {
    console.log(`[check-env-local] OK: ${msg}`);
}

function fileExists(/** @type {string} */ p) {
    try {
        fs.accessSync(p, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function isTracked(/** @type {string} */ relPath) {
    try {
        await execa('git', ['ls-files', '--error-unmatch', relPath], { cwd: ROOT, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

async function main() {
    const gitignorePath = path.join(ROOT, '.gitignore');
    if (!fileExists(gitignorePath)) fail('Missing .gitignore');

    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    if (!gitignore.includes('\n.env.local') && !gitignore.includes('\r\n.env.local')) {
        fail('.gitignore must include `.env.local`');
    }
    if (!gitignore.includes('.env.*.local')) {
        fail('.gitignore must include `.env.*.local`');
    }
    ok('.gitignore includes env local ignore rules');

    const examplePath = path.join(ROOT, '.env.local.example');
    if (!fileExists(examplePath)) fail('Missing .env.local.example (template should be committed)');
    ok('.env.local.example exists');

    const expertExamplePath = path.join(ROOT, '.env.expert.example');
    if (!fileExists(expertExamplePath)) fail('Missing .env.expert.example (expert template should be committed)');
    ok('.env.expert.example exists');

    if (await isTracked('.env.local')) {
        fail('`.env.local` is tracked by git. Remove it from the index and keep it ignored.');
    }
    ok('`.env.local` is not tracked');
}

main().catch((err) => fail(err?.message || String(err)));
