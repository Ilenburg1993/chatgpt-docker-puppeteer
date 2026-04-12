// @ts-check
/**
 * tests/unit/copilot/test_terminal_repl_listeners.spec.js
 *
 * Contrato: terminal/repl-listeners.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describe, it } from 'node:test';

describe("terminal/repl-listeners.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/repl-listeners.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta setupAgentListeners", async () => {
        const mod = await import("../../../src/copilot/terminal/repl-listeners.js");
        assert.equal(typeof mod.setupAgentListeners !== "undefined", true, "setupAgentListeners deve estar exportado");
    });

});
