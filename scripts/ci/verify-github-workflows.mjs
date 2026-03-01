#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';

const strict = process.argv.includes('--strict');
const allowedDynamicWorkflows = new Set(['Dependabot Updates', 'Claude']);

function parseOriginRemote(url) {
    const trimmed = String(url || '').trim();
    const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) {
        return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
        return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    throw new Error(`[ci] Unable to parse GitHub origin remote: ${trimmed}`);
}

function execText(command, args) {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function readLocalWorkflowNames() {
    const workflowsDir = path.resolve('.github/workflows');
    const files = fs
        .readdirSync(workflowsDir)
        .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
        .sort();

    return files.map(file => {
        const raw = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
        const parsed = yaml.load(raw);
        return {
            file,
            name: parsed?.name || file,
            path: `.github/workflows/${file}`,
        };
    });
}

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

try {
    const originUrl = execText('git', ['remote', 'get-url', 'origin']);
    const { owner, repo } = parseOriginRemote(originUrl);
    const local = readLocalWorkflowNames();
    const remote = readRemoteWorkflows(owner, repo);

    const localByName = new Map(local.map(item => [item.name, item]));
    const remoteVersioned = remote.filter(item => String(item.path || '').startsWith('.github/workflows/'));
    const remoteDynamic = remote.filter(item => !String(item.path || '').startsWith('.github/workflows/'));

    const remoteVersionedNames = new Set(remoteVersioned.map(item => item.name));
    const missingRemote = local.filter(item => !remoteVersionedNames.has(item.name));
    const unexpectedRemoteVersioned = remoteVersioned.filter(item => !localByName.has(item.name));
    const unexpectedDynamic = remoteDynamic.filter(item => !allowedDynamicWorkflows.has(item.name));

    console.log(`[ci] Local versioned workflows: ${local.length}`);
    console.log(`[ci] Remote versioned workflows recognized by GitHub: ${remoteVersioned.length}`);

    if (remoteDynamic.length > 0) {
        console.log('[ci] Dynamic/external workflows reported by GitHub:');
        for (const item of remoteDynamic) {
            console.log(`  - ${item.name} (${item.path})`);
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
            console.log(`  - ${item.name} (${item.path})`);
        }
    }

    if (unexpectedDynamic.length > 0) {
        console.log('[ci] Unexpected dynamic workflows reported by GitHub:');
        for (const item of unexpectedDynamic) {
            console.log(`  - ${item.name} (${item.path})`);
        }
    }

    const hasMismatch =
        missingRemote.length > 0 || unexpectedRemoteVersioned.length > 0 || unexpectedDynamic.length > 0;

    if (hasMismatch && strict) {
        console.error('[ci] Remote workflow recognition mismatch detected.');
        process.exit(1);
    }

    if (hasMismatch) {
        console.log('[ci] Remote workflow verification completed with non-blocking differences.');
    } else {
        console.log('[ci] Remote workflow verification OK.');
    }
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
}
