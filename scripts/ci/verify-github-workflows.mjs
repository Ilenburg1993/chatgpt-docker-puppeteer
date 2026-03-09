#!/usr/bin/env node
// @ts-check
import yaml from 'js-yaml';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict');
const allowedDynamicWorkflows = new Set(['Dependabot Updates', 'Claude']);
const requiredTypingCommands = [
    'npm run typecheck:repo',
    'npm run typecheck:strict:public',
    'npm run typecheck:strict:all',
    'npm run typecheck:declarations',
    'npm run jsdoc:coverage:json',
    'npm run jsdoc:coverage:public',
    'npm run check:schemas:typing',
    'npm run analyze:typing',
    'npm run analyze:typing:public',
    'npm run check:skills:strict',
];

/**
 * @param {string} url
 * @returns {{ owner: string; repo: string }}
 */
function parseOriginRemote(url) {
    const trimmed = String(url || '').trim();
    const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) return { owner: sshMatch[1] ?? '', repo: sshMatch[2] ?? '' };

    const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) return { owner: httpsMatch[1] ?? '', repo: httpsMatch[2] ?? '' };

    throw new Error(`[ci] Unable to parse GitHub origin remote: ${trimmed}`);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
function execText(command, args) {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * @returns {{ file: string; name: string; path: string }[]}
 */
function readLocalWorkflowNames() {
    const workflowsDir = path.resolve('.github/workflows');
    const files = fs
        .readdirSync(workflowsDir)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .sort();

    return files.map((file) => {
        const raw = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
        const parsed = /** @type {Record<string, unknown> | null} */ (yaml.load(raw));
        return {
            file,
            name: String(parsed?.name || file),
            path: `.github/workflows/${file}`,
        };
    });
}

/**
 * @param {string} owner
 * @param {string} repo
 * @returns {Record<string, unknown>[]}
 */
function readRemoteWorkflows(owner, repo) {
    const payload = execText('gh', [
        'api',
        '-H',
        'Accept: application/vnd.github+json',
        '-H',
        'X-GitHub-Api-Version: 2022-11-28',
        `repos/${owner}/${repo}/actions/workflows?per_page=100`,
    ]);
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed?.workflows) ? parsed.workflows : [];
}

/**
 * @returns {string[]}
 */
function validateTypingWorkflowContract() {
    const workflowPath = path.resolve('.github/workflows/jsdoc-typing.yml');
    if (!fs.existsSync(workflowPath)) {
        return [`Missing typing workflow: ${workflowPath}`];
    }

    const raw = fs.readFileSync(workflowPath, 'utf8');
    /** @type {string[]} */
    const issues = [];
    for (const command of requiredTypingCommands) {
        if (!raw.includes(command)) {
            issues.push(`Typing workflow must include command: ${command}`);
        }
    }
    let previousIndex = -1;
    for (const command of requiredTypingCommands) {
        const currentIndex = raw.indexOf(command);
        if (currentIndex === -1) {
            continue;
        }
        if (currentIndex < previousIndex) {
            issues.push(`Typing workflow must keep canonical command order: ${command}`);
            break;
        }
        previousIndex = currentIndex;
    }
    if (raw.includes('continue-on-error: true')) {
        issues.push('Typing workflow must remain blocking and cannot use continue-on-error: true.');
    }
    if (!raw.includes('pull_request:') || !raw.includes('push:')) {
        issues.push('Typing workflow must run on push and pull_request.');
    }
    return issues;
}

try {
    const originUrl = execText('git', ['remote', 'get-url', 'origin']);
    const { owner, repo } = parseOriginRemote(originUrl);
    const local = readLocalWorkflowNames();
    const remote = readRemoteWorkflows(owner, repo);

    const localByName = new Map(local.map((item) => [item.name, item]));
    const remoteVersioned = remote.filter((item) => String(item.path || '').startsWith('.github/workflows/'));
    const remoteDynamic = remote.filter((item) => !String(item.path || '').startsWith('.github/workflows/'));
    const remoteVersionedNames = new Set(remoteVersioned.map((item) => String(item.name || '')));

    const missingRemote = local.filter((item) => !remoteVersionedNames.has(item.name));
    const unexpectedRemoteVersioned = remoteVersioned.filter((item) => !localByName.has(String(item.name || '')));
    const unexpectedDynamic = remoteDynamic.filter((item) => !allowedDynamicWorkflows.has(String(item.name || '')));
    const typingWorkflowIssues = validateTypingWorkflowContract();

    console.log(`[ci] Local versioned workflows: ${local.length}`);
    console.log(`[ci] Remote versioned workflows recognized by GitHub: ${remoteVersioned.length}`);

    if (typingWorkflowIssues.length > 0) {
        console.log('[ci] Typing workflow contract issues:');
        for (const issue of typingWorkflowIssues) {
            console.log(`  - ${issue}`);
        }
    }

    if (remoteDynamic.length > 0) {
        console.log('[ci] Dynamic/external workflows reported by GitHub:');
        for (const item of remoteDynamic) {
            console.log(`  - ${String(item.name || 'unknown')} (${String(item.path || '')})`);
        }
    }

    if (missingRemote.length > 0) {
        console.log('[ci] Local workflows not yet recognized remotely:');
        for (const item of missingRemote) {
            console.log(`  - ${item.name} (${item.path})`);
        }
    }

    if (unexpectedRemoteVersioned.length > 0) {
        console.log('[ci] Remote versioned workflows missing locally:');
        for (const item of unexpectedRemoteVersioned) {
            console.log(`  - ${String(item.name || 'unknown')} (${String(item.path || '')})`);
        }
    }

    if (unexpectedDynamic.length > 0) {
        console.log('[ci] Unexpected dynamic workflows reported by GitHub:');
        for (const item of unexpectedDynamic) {
            console.log(`  - ${String(item.name || 'unknown')} (${String(item.path || '')})`);
        }
    }

    const hasMismatch =
        typingWorkflowIssues.length > 0 ||
        missingRemote.length > 0 ||
        unexpectedRemoteVersioned.length > 0 ||
        unexpectedDynamic.length > 0;

    if (hasMismatch && strict) {
        console.error('[ci] Workflow verification mismatch detected.');
        process.exit(1);
    }

    if (hasMismatch) {
        console.log('[ci] Workflow verification completed with non-blocking differences.');
    } else {
        console.log('[ci] Workflow verification OK.');
    }
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
}
