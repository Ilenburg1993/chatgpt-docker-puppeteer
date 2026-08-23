// @ts-check
import { normalizeElicitationResultWithSchema } from '#copilot/sdk/session';
import { describe, expect, it } from 'vitest';
const accept = (/** @type {Record<string, unknown>} */ content) => ({ action: 'accept', content });
describe('SDK elicitation schema', () => {
    it('implements oneOf as exactly one matching branch, not anyOf', () => {
        const schema = { type: 'object', properties: { value: { oneOf: [{ type: 'number' }, { type: 'integer' }] } } };
        expect(() => normalizeElicitationResultWithSchema(accept({ value: 1 }), schema)).toThrow(/oneOf/u);
        expect(normalizeElicitationResultWithSchema(accept({ value: 1.5 }), schema)).toEqual(accept({ value: 1.5 }));
    });
    it('rejects impossible calendar dates', () => {
        const schema = { type: 'object', properties: { day: { type: 'string', format: 'date' } } };
        expect(() => normalizeElicitationResultWithSchema(accept({ day: '2026-02-31' }), schema)).toThrow(
            /formato date/u,
        );
        expect(normalizeElicitationResultWithSchema(accept({ day: '2024-02-29' }), schema)).toEqual(
            accept({ day: '2024-02-29' }),
        );
    });
    it('validates defaults through the same field validator', () => {
        const schema = { type: 'object', properties: { count: { type: 'integer', default: 'not-int' } } };
        expect(() => normalizeElicitationResultWithSchema({ action: 'accept' }, schema)).toThrow(/count.*integer/u);
    });
    it('honors additionalProperties=false', () => {
        const schema = { type: 'object', additionalProperties: false, properties: { known: { type: 'string' } } };
        expect(() => normalizeElicitationResultWithSchema(accept({ known: 'x', extra: 'y' }), schema)).toThrow(
            /não permitido/u,
        );
    });
});
