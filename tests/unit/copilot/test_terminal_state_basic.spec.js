// @ts-check
/**
 * tests/unit/copilot/test_terminal_state_basic.spec.js
 *
 * Contrato: terminal/state.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("terminal/state.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/state.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta getBusy", async () => {
        const mod = await import("../../../src/copilot/terminal/state.js");
        assert.equal(typeof mod.getBusy !== "undefined", true, "getBusy deve estar exportado");
    });

    it("exporta setBusy", async () => {
        const mod = await import("../../../src/copilot/terminal/state.js");
        assert.equal(typeof mod.setBusy !== "undefined", true, "setBusy deve estar exportado");
    });

    it("exporta getPlanMode", async () => {
        const mod = await import("../../../src/copilot/terminal/state.js");
        assert.equal(typeof mod.getPlanMode !== "undefined", true, "getPlanMode deve estar exportado");
    });

    it("exporta setPlanMode", async () => {
        const mod = await import("../../../src/copilot/terminal/state.js");
        assert.equal(typeof mod.setPlanMode !== "undefined", true, "setPlanMode deve estar exportado");
    });

    it("exporta getTerminalPhase", async () => {
        const mod = await import("../../../src/copilot/terminal/state.js");
        assert.equal(typeof mod.getTerminalPhase !== "undefined", true, "getTerminalPhase deve estar exportado");
    });

    it("exporta TerminalPhase", async () => {
        const mod = await import("../../../src/copilot/terminal/state.js");
        assert.equal(typeof mod.TerminalPhase !== "undefined", true, "TerminalPhase deve estar exportado");
    });

});
