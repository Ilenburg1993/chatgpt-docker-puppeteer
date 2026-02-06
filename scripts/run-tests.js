#!/usr/bin/env nodeimport { spawnSync } from 'node:child_process';
import os from 'node:os';

const platform = os.platform();
let cmd;
if (platform === 'win32') {
    cmd = 'powershell -ExecutionPolicy Bypass -File scripts/run_all_tests.ps1';
} else {
    cmd = 'bash scripts/run_all_tests.sh';
}

const res = spawnSync(cmd, { shell: true, stdio: 'inherit' });
process.exit(res.status || 0);
