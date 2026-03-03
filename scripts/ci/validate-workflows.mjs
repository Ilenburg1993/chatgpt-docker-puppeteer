#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const workflowsDir = path.resolve('.github/workflows');
if (!fs.existsSync(workflowsDir)) {
    console.error('[ci] .github/workflows directory not found.');
    process.exit(1);
}

const githubDir = path.resolve('.github');
const dependabotPath = path.join(githubDir, 'dependabot.yml');
const requiredGithubDocs = ['AGENTS.md', 'COPILOT_CONFIG.md', 'README.md'];
const requiredCiScripts = ['validate-workflows.mjs', 'verify-github-workflows.mjs'];
const requiredScheduledWorkflowKeys = ['concurrency'];
const workflowsRequiringConcurrency = new Set([
    'audit-nightly.yml',
    'ci.yml',
    'code-quality.yml',
    'copilot-setup-steps.yml',
    'coverage.yml',
    'dashboard-build.yml',
    'dependency-hygiene.yml',
    'dependency-review.yml',
    'docker-rebuild.yml',
    'docker-security-scan.yml',
    'jsdoc-typing.yml',
    'release.yml',
    'scorecard.yml',
    'security.yml',
    'semantic-analysis.yml',
    'stale.yml',
]);
const uploadArtifactPattern = /^actions\/upload-artifact@/;
const requiredPinnedActionRefs = new Map([
    ['raven-actions/actionlint', 'v2.1.2'],
    ['reviewdog/action-shellcheck', 'v1.32.0'],
    ['hadolint/hadolint-action', 'v3.3.0'],
    ['dependabot/fetch-metadata', 'v2.5.0'],
    ['actions/dependency-review-action', 'v4.8.3'],
]);
const seenWorkflowNames = new Set();

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

    if (seenWorkflowNames.has(parsed.name)) {
        throw new Error(`[ci] Duplicate workflow name '${parsed.name}' detected in ${file}`);
    }
    seenWorkflowNames.add(parsed.name);

    if (!parsed.on) {
        throw new Error(`[ci] Missing required field 'on' in ${file}`);
    }

    if (!parsed.jobs || Object.keys(parsed.jobs).length === 0) {
        throw new Error(`[ci] Missing required field 'jobs' in ${file}`);
    }

    const schedules = Array.isArray(parsed.on?.schedule) ? parsed.on.schedule : [];
    for (const entry of schedules) {
        const cron = String(entry?.cron || '').trim();
        if (!cron) {
            throw new Error(`[ci] Empty cron schedule entry in ${file}`);
        }
        const minuteField = cron.split(/\s+/)[0];
        if (minuteField === '0') {
            throw new Error(`[ci] Scheduled workflow ${file} must not run at minute 0 (${cron})`);
        }
    }

    if (!parsed.permissions || typeof parsed.permissions !== 'object') {
        throw new Error(`[ci] Missing required top-level 'permissions' map in ${file}`);
    }

    if (workflowsRequiringConcurrency.has(file)) {
        for (const key of requiredScheduledWorkflowKeys) {
            if (!parsed[key]) {
                throw new Error(`[ci] Missing required top-level '${key}' in ${file}`);
            }
        }
    }

    for (const [jobName, job] of Object.entries(parsed.jobs)) {
        if (!job || typeof job !== 'object') {
            throw new Error(`[ci] Invalid job definition '${jobName}' in ${file}`);
        }

        if (typeof job['timeout-minutes'] !== 'number') {
            throw new Error(`[ci] Missing numeric 'timeout-minutes' in ${file} job '${jobName}'`);
        }

        if (!Array.isArray(job.steps) || job.steps.length === 0) {
            continue;
        }

        for (const step of job.steps) {
            if (!step || typeof step !== 'object') {
                continue;
            }

            if (typeof step.uses === 'string' && uploadArtifactPattern.test(step.uses)) {
                if (!step.with || typeof step.with !== 'object') {
                    throw new Error(`[ci] Upload artifact step missing 'with' block in ${file} job '${jobName}'`);
                }
                if (typeof step.with['retention-days'] !== 'number') {
                    throw new Error(
                        `[ci] Upload artifact step missing numeric 'retention-days' in ${file} job '${jobName}'`
                    );
                }
            }

            if (typeof step.uses === 'string') {
                const [actionRef, ref = ''] = step.uses.split('@');
                const expectedRef = requiredPinnedActionRefs.get(actionRef);
                if (expectedRef && ref !== expectedRef) {
                    throw new Error(
                        `[ci] Action ${actionRef} must be pinned to ${expectedRef} in ${file} job '${jobName}'`
                    );
                }
            }
        }
    }
}

if (!fs.existsSync(dependabotPath)) {
    throw new Error('[ci] Missing .github/dependabot.yml');
}

const dependabotRaw = fs.readFileSync(dependabotPath, 'utf8');
const dependabotParsed = yaml.load(dependabotRaw);
if (!dependabotParsed || typeof dependabotParsed !== 'object') {
    throw new Error('[ci] Invalid YAML object in .github/dependabot.yml');
}
if (dependabotParsed.version !== 2) {
    throw new Error('[ci] .github/dependabot.yml must declare version: 2');
}
if (!Array.isArray(dependabotParsed.updates) || dependabotParsed.updates.length === 0) {
    throw new Error('[ci] .github/dependabot.yml must declare at least one updates entry');
}

for (const [index, update] of dependabotParsed.updates.entries()) {
    if (!update || typeof update !== 'object') {
        throw new Error(`[ci] Invalid updates entry at index ${index} in .github/dependabot.yml`);
    }
    if (!update['package-ecosystem']) {
        throw new Error(`[ci] updates[${index}] missing 'package-ecosystem' in .github/dependabot.yml`);
    }
    if (!update.directory) {
        throw new Error(`[ci] updates[${index}] missing 'directory' in .github/dependabot.yml`);
    }
    if (!update['target-branch']) {
        throw new Error(`[ci] updates[${index}] missing 'target-branch' in .github/dependabot.yml`);
    }
    if (!update.schedule || typeof update.schedule !== 'object' || !update.schedule.interval) {
        throw new Error(`[ci] updates[${index}] missing 'schedule.interval' in .github/dependabot.yml`);
    }
    if (typeof update.schedule.time === 'string' && update.schedule.time.endsWith(':00')) {
        throw new Error(
            `[ci] updates[${index}] schedule.time must avoid the top of the hour in .github/dependabot.yml`
        );
    }
    if (!Array.isArray(update.labels) || update.labels.length === 0) {
        throw new Error(`[ci] updates[${index}] must declare at least one label in .github/dependabot.yml`);
    }
    if (typeof update['open-pull-requests-limit'] !== 'number') {
        throw new Error(`[ci] updates[${index}] missing numeric 'open-pull-requests-limit' in .github/dependabot.yml`);
    }
    if (!update['pull-request-branch-name'] || !update['pull-request-branch-name'].separator) {
        throw new Error(
            `[ci] updates[${index}] missing 'pull-request-branch-name.separator' in .github/dependabot.yml`
        );
    }
}

for (const relativePath of requiredGithubDocs) {
    const fullPath = path.join(githubDir, relativePath);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`[ci] Missing required .github documentation file: ${relativePath}`);
    }
}

for (const relativePath of requiredCiScripts) {
    const fullPath = path.join(path.resolve('scripts/ci'), relativePath);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`[ci] Missing required CI workflow script: scripts/ci/${relativePath}`);
    }
}

console.log(
    `[ci] Workflow validation OK (${files.length} workflow files, dependabot config, .github docs and CI workflow scripts present)`
);
