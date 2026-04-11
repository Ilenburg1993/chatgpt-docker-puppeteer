// @ts-check
/**
 * tests/unit/copilot/test_terminal_agent_wiring.spec.js
 *
 * Contrato: terminal/terminal-agent-wiring.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("terminal/terminal-agent-wiring.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/terminal-agent-wiring.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta registerAgentEventListeners", async () => {
        const mod = await import("../../../src/copilot/terminal/terminal-agent-wiring.js");
        assert.equal(typeof mod.registerAgentEventListeners !== "undefined", true, "registerAgentEventListeners deve estar exportado");
    });

});
