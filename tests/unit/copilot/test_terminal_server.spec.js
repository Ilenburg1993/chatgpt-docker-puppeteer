// @ts-check
/**
 * tests/unit/copilot/test_terminal_server.spec.js
 *
 * Contrato: terminal/server.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("terminal/server.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/server.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta createInjectServer", async () => {
        const mod = await import("../../../src/copilot/terminal/server.js");
        assert.equal(typeof mod.createInjectServer !== "undefined", true, "createInjectServer deve estar exportado");
    });

});
