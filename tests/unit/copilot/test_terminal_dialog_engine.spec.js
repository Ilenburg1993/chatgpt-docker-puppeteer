// @ts-check
/**
 * tests/unit/copilot/test_terminal_dialog_engine.spec.js
 *
 * Contrato: terminal/dialog/engine.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("terminal/dialog/engine.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/dialog/engine.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta sendTurn", async () => {
        const mod = await import("../../../src/copilot/terminal/dialog/engine.js");
        assert.equal(typeof mod.sendTurn !== "undefined", true, "sendTurn deve estar exportado");
    });

    it("exporta ensureDialogLoop", async () => {
        const mod = await import("../../../src/copilot/terminal/dialog/engine.js");
        assert.equal(typeof mod.ensureDialogLoop !== "undefined", true, "ensureDialogLoop deve estar exportado");
    });

    it("exporta getTurnQueueDepth", async () => {
        const mod = await import("../../../src/copilot/terminal/dialog/engine.js");
        assert.equal(typeof mod.getTurnQueueDepth !== "undefined", true, "getTurnQueueDepth deve estar exportado");
    });

});
