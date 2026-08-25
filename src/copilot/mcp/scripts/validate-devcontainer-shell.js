// @ts-check
/** Stable launcher for bounded DevContainer Bash validation. */

import { readMcpValidationProcessConfig } from '#copilot/mcp/public/validation';
import { runDevcontainerShellValidationCli } from '#copilot/mcp/public/validation/devcontainer-shell';

process.exitCode = await runDevcontainerShellValidationCli(readMcpValidationProcessConfig(process.env));
