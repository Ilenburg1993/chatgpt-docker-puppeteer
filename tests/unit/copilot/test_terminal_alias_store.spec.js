// @ts-check
/**
 * tests/unit/copilot/test_terminal_alias_store.spec.js
 *
 * Contrato: terminal/alias-store.js
 */

import assert from "node:assert/strict";
import { describe, it } from 'node:test';
describe("terminal/alias-store.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/alias-store.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta setAlias", async () => {
        const mod = await import("../../../src/copilot/terminal/alias-store.js");
        assert.equal(typeof mod.setAlias !== "undefined", true, "setAlias deve estar exportado");
    });

    it("exporta getAliases", async () => {
        const mod = await import("../../../src/copilot/terminal/alias-store.js");
        assert.equal(typeof mod.getAliases !== "undefined", true, "getAliases deve estar exportado");
    });

    it("exporta resolve", async () => {
        const mod = await import("../../../src/copilot/terminal/alias-store.js");
        assert.equal(typeof mod.resolve !== "undefined", true, "resolve deve estar exportado");
    });

    it("exporta resetAliases", async () => {
        const mod = await import("../../../src/copilot/terminal/alias-store.js");
        assert.equal(typeof mod.resetAliases !== "undefined", true, "resetAliases deve estar exportado");
    });

});
