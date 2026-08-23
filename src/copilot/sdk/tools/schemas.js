// @ts-check
/** @module copilot/sdk/tools/schemas */
import { z } from 'zod';

export const CustomToolDefinitionSchema = z.object({
    name: z.string(),
    description: z.string(),
    handlerId: z.string(),
    parameters: z.record(z.string(), z.unknown()).optional(),
});

export const CustomToolsFileSchema = z.array(CustomToolDefinitionSchema);

export const ToolsConfigSchema = z.object({
    allowlist: z.array(z.string()).nullable(),
    denylist: z.array(z.string()),
});
