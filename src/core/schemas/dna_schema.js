/* ==========================================================================
   src/core/schemas/dna_schema.js
   Audit Level: 100 — Industrial Hardening (Evolutionary DNA - Platinum)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Definir a estrutura das regras dinâmicas e seletores
                     aprendidos pelo SADI. Garante a integridade da evolução.
   Sincronizado com: BaseDriver.js (V255), stabilizer.js (V41), io.js (V36).
========================================================================== */

const { z } = require('zod');
const { TIMESTAMP_SCHEMA } = require('./shared_types');

/**
 * SelectorProtocolSchema: O formato de saída do SADI V10+.
 * Define como o robô deve localizar e interagir com um elemento.
 */
const SelectorProtocolSchema = z.object({
    selector: z.string().min(1),
    context: z.enum(['root', 'iframe', 'cross-origin']).default('root'),
    isShadow: z.boolean().default(false),
    frameSelector: z.string().nullable().default(null),
    framePath: z.string().nullable().default(null),
    // [FIX 1.5] Sincronia de Protocolo: timestamp deve ser Unix Epoch em ms
    // Alinhado com Date.now() usado no Driver e no Stabilizer para evitar dessincronia.
    timestamp: z.number().optional()
});

/**
 * DomainRulesSchema: Conjunto de regras específicas para um domínio (ex: chatgpt.com).
 */
const DomainRulesSchema = z
    .object({
        // Mapeamento de intenção (ex: input_box) para protocolo ou seletor legado
        // [FIX] z.record precisa de key schema explícito
        selectors: z
            .record(
                z.string(), // Key: nome do seletor (input_box, send_button, etc)
                z.union([
                    z.array(z.string()), // Legado: Lista de seletores em string
                    SelectorProtocolSchema // Moderno: Protocolo estruturado SADI V10+
                ])
            )
            .default({}),

        // Sobrescritas de comportamento aprendidas ou manuais
        behavior_overrides: z
            .object({
                idle_sleep_ms: z.number().optional(),
                stability_threshold: z.number().optional(),
                typing_speed_factor: z.number().optional()
            })
            .default({})
    })
    .passthrough(); // Permite evolução genética para novas propriedades de IA

/**
 * DNA_SCHEMA: O contrato mestre do arquivo dynamic_rules.json.
 */
const DnaSchema = z
    .object({
        _meta: z
            .object({
                version: z.number().default(1),
                last_updated: TIMESTAMP_SCHEMA,
                updated_by: z.string().default('system_init'),
                evolution_count: z.number().nonnegative().default(0)
            })
            .optional()
            .default({
                version: 1,
                last_updated: new Date().toISOString(),
                updated_by: 'system_init',
                evolution_count: 0
            }),

        // Mapeamento de Domínio -> Regras (ex: { "chatgpt.com": { ... } })
        // [FIX] z.record precisa de key schema explícito para validar corretamente
        targets: z.record(z.string(), DomainRulesSchema).default({}),

        // Regras globais de fallback (Padrões universais de chat)
        // [FIX] z.record precisa de key schema explícito
        global_selectors: z.record(z.string(), z.array(z.string())).default({
            input_box: ['textarea', "div[contenteditable='true']", "[role='textbox']"],
            send_button: ["button[type='submit']", "[data-testid='send-button']", "[aria-label*='Send']"]
        })
    })
    .passthrough();

module.exports = {
    DnaSchema,
    SelectorProtocolSchema,
    DomainRulesSchema
};
