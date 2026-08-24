// @ts-check
/** Stable launcher for allowlisted MCP/Copilot validation suites. */

import { runSafeValidationSuiteCli } from '#copilot/mcp/public/validation/suites';

process.exitCode = await runSafeValidationSuiteCli(process.argv.slice(2));
