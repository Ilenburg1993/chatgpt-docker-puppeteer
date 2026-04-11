// @ts-check
/**
 * tests/unit/copilot/test_terminal_workspace_ctx.spec.js
 *
 * Contrato: terminal/workspace-context.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("terminal/workspace-context.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/workspace-context.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta getWorkspaceContext", async () => {
        const mod = await import("../../../src/copilot/terminal/workspace-context.js");
        assert.equal(typeof mod.getWorkspaceContext !== "undefined", true, "getWorkspaceContext deve estar exportado");
    });

    it("exporta getWorkspaceContextAsync", async () => {
        const mod = await import("../../../src/copilot/terminal/workspace-context.js");
        assert.equal(typeof mod.getWorkspaceContextAsync !== "undefined", true, "getWorkspaceContextAsync deve estar exportado");
    });

});
