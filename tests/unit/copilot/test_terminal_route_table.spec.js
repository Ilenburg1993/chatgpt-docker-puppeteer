// @ts-check
/**
 * tests/unit/copilot/test_terminal_route_table.spec.js
 *
 * Contrato: terminal/route-table.js
 */

import assert from "node:assert/strict";
import { describe, it } from 'node:test';
describe("terminal/route-table.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/route-table.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta ROUTE_TABLE", async () => {
        const mod = await import("../../../src/copilot/terminal/route-table.js");
        assert.equal(typeof mod.ROUTE_TABLE !== "undefined", true, "ROUTE_TABLE deve estar exportado");
    });

    it("exporta matchRoute", async () => {
        const mod = await import("../../../src/copilot/terminal/route-table.js");
        assert.equal(typeof mod.matchRoute !== "undefined", true, "matchRoute deve estar exportado");
    });

});
