// @ts-check

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LINUX_ARGV = resolve('src/copilot/infra/platform/process/introspection/linux-argv.js');
const RESOURCES = resolve('src/copilot/infra/platform/process/introspection/resources.js');
const PUBLIC = resolve('src/copilot/infra/public/platform/process/introspection/index.js');
const MCP_JOBS = resolve('src/copilot/mcp/control-plane/jobs.js');
const OLD_MCP_OWNER = resolve('src/copilot/mcp/control-plane/process-introspection.js');
const CONFIGURED_GRANTS = resolve('config/architecture/copilot-configured-fs-grants.json');
const BOOT_WORKSPACE = resolve('src/copilot/boot/workspace.js');

describe('platform/process introspection governance', () => {
    it('keeps /proc and cgroup pseudo-files inside the pathless process capability', () => {
        const argv = readFileSync(LINUX_ARGV, 'utf8');
        const resources = readFileSync(RESOURCES, 'utf8');
        expect(argv).toContain('/proc/${processId}/cmdline');
        expect(argv).toContain('readLinuxProcessArgv(pid');
        expect(resources).toContain("'/sys/fs/cgroup/memory.current'");
        expect(resources).toContain("'/sys/fs/cgroup/memory.max'");
        expect(resources).toContain("'/sys/fs/cgroup/memory.events'");
        expect(resources).not.toContain('createConfiguredFsGrant');
        expect(resources).not.toContain('createConfiguredFsIo');
    });

    it('exposes no caller-controlled pseudo-file path and leaves parsers internal', () => {
        const publicSource = readFileSync(PUBLIC, 'utf8');
        expect(publicSource).toContain('readLinuxProcessArgv');
        expect(publicSource).toContain('readProcessResourceSnapshot');
        expect(publicSource).not.toContain('parseCgroupMemoryEvents');
        expect(publicSource).not.toContain('parseCgroupMemoryLimit');
        expect(publicSource).not.toContain('readOptionalBoundedSpecialText');
    });

    it('removes MCP pseudo-file ownership and the obsolete cgroup filesystem grant', () => {
        expect(existsSync(OLD_MCP_OWNER)).toBe(false);
        const jobs = readFileSync(MCP_JOBS, 'utf8');
        expect(jobs).toContain('#copilot/infra/public/platform/process/introspection');
        expect(jobs).toContain('readProcessResourceSnapshot');
        expect(jobs).not.toContain('/sys/fs/cgroup');
        expect(jobs).not.toContain('mcp.control-plane.jobs.cgroup');

        const grants = readFileSync(CONFIGURED_GRANTS, 'utf8');
        expect(grants).not.toContain('mcp.control-plane.jobs.cgroup');
    });

    it('keeps workspace/Git discovery in boot because it is application boot policy, not process introspection', () => {
        const workspace = readFileSync(BOOT_WORKSPACE, 'utf8');
        expect(workspace).toContain('@module copilot/boot/workspace');
        expect(workspace).toContain('resolveBootWorkspaceRoot');
        expect(workspace).toContain('getWorkspaceContext');
        expect(workspace).toContain("'git'");
        expect(workspace).not.toContain('/proc/');
        expect(workspace).not.toContain('/sys/fs/cgroup');
    });
});
