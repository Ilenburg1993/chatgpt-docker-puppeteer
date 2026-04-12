// @ts-check
/**
 * tests/unit/copilot/test_terminal_dialog_barrel.spec.js
 *
 * Contrato: terminal/dialog/index.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describe, it } from 'node:test';

describe("terminal/dialog/index.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/dialog/index.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta BOOT_PROMPT", async () => {
        const mod = await import("../../../src/copilot/terminal/dialog/index.js");
        assert.equal(typeof mod.BOOT_PROMPT !== "undefined", true, "BOOT_PROMPT deve estar exportado");
    });

    it("exporta PROMPT_USER", async () => {
        const mod = await import("../../../src/copilot/terminal/dialog/index.js");
        assert.equal(typeof mod.PROMPT_USER !== "undefined", true, "PROMPT_USER deve estar exportado");
    });

});
