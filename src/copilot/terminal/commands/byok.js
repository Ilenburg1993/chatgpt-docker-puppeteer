// @ts-check
/**
 * src/copilot/terminal/commands/byok.js
 *
 * Diagnostico seguro da configuracao BYOK do SDK Copilot. Este comando nunca imprime segredos; ele mostra apenas
 * presenca de credenciais, provider/modelo efetivos e erros acionaveis.
 *
 * @module copilot/terminal/commands/byok
 */

import { config as loadDotenv } from 'dotenv';

import { readTerminalByokProjection } from '../frontend/index.js';

/**
 * @typedef {object} ByokCommandContext
 * @property {(text: string) => void} println
 */

/**
 * @param {boolean} value
 * @returns {string}
 */
function yesNo(value) {
    return value ? '\x1b[32msim\x1b[0m' : '\x1b[90mnao\x1b[0m';
}

/**
 * @param {string | null} value
 * @returns {string}
 */
function valueOrDash(value) {
    return value && value.length > 0 ? value : '-';
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderStatus(projection, println) {
    const { summary } = projection;
    println('\n  \x1b[36mBYOK status\x1b[0m');
    println(`    enabled:       ${yesNo(summary.enabled)}`);
    println(`    ready:         ${yesNo(summary.ready)}`);
    println(`    profile:       \x1b[33m${valueOrDash(summary.profile)}\x1b[0m`);
    println(`    preset:        \x1b[33m${valueOrDash(summary.preset)}\x1b[0m`);
    println(`    provider:      \x1b[33m${valueOrDash(summary.providerType)}\x1b[0m`);
    println(`    baseUrl:       \x1b[33m${valueOrDash(summary.baseUrl)}\x1b[0m`);
    println(`    model:         \x1b[33m${valueOrDash(summary.model)}\x1b[0m`);
    println(`    wireApi:       \x1b[33m${valueOrDash(summary.wireApi)}\x1b[0m`);
    println(`    azureVersion:  \x1b[33m${valueOrDash(summary.azureApiVersion)}\x1b[0m`);
    println(
        `    auth:          apiKey=${yesNo(summary.auth.apiKeyConfigured)} · bearer=${yesNo(summary.auth.bearerTokenConfigured)} · headers=${yesNo(summary.auth.headersConfigured)}`,
    );
    println(
        `    capabilities:  reasoning=${yesNo(summary.capabilities.reasoningEffort)} · vision=${yesNo(summary.capabilities.vision)} · ctx=${summary.capabilities.contextWindowTokens}`,
    );
    println(`    modelList:     ${summary.modelList.count} modelo(s)`);
    for (const warning of summary.warnings) {
        println(`  \x1b[33m  aviso: ${warning}\x1b[0m`);
    }
    for (const error of summary.errors) {
        println(`  \x1b[31m  erro: ${error}\x1b[0m`);
    }
    println('  \x1b[90mArquivo unico de BYOK: .env.local. Mudancas via comando valem para o processo atual; use /restart para nova sessao SDK.\x1b[0m');
    println('  \x1b[90mUso: /byok | /byok reload | /byok profiles | /byok use <perfil|sdk> | /byok model <id> | /byok provider <preset> [model] [baseUrl] | /byok env\x1b[0m\n');
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeArg(value) {
    return value.trim();
}

/**
 * @param {ByokCommandContext} ctx
 * @param {string | undefined} arg
 * @returns {Promise<void>}
 */
export async function cmdByok({ println }, arg) {
    const raw = (arg ?? '').trim();
    const [rawSub = 'status', ...rest] = raw.split(/\s+/u);
    const sub = rawSub.toLowerCase();
    const projection = readTerminalByokProjection();
    const { envKeys, models, profiles, summary } = projection;

    if (sub === 'env') {
        println('\n  \x1b[36mBYOK env canonico\x1b[0m');
        println('  \x1b[90mArquivo unico para o operador: .env.local (gitignored). Coloque perfis, modelos, metadata e segredos apenas ali.\x1b[0m\n');
        for (const key of envKeys) {
            println(`    \x1b[33m${key}\x1b[0m`);
        }
        println('\n  \x1b[90mPerfis vivem em COPILOT_BYOK_PROFILES_JSON; o ativo em COPILOT_BYOK_PROFILE. Exemplos seguros ficam em .env.local.example.\x1b[0m');
        println('  \x1b[90mUso: /byok | /byok profiles | /byok models | /byok env\x1b[0m\n');
        return;
    }

    if (sub === 'reload') {
        const result = loadDotenv({ path: '.env.local', override: true });
        if (result.error) {
            println(`  \x1b[31mNão foi possível recarregar .env.local: ${result.error.message}\x1b[0m\n`);
            return;
        }
        println('  \x1b[32m.env.local recarregado no processo atual. Segredos não foram exibidos.\x1b[0m');
        renderStatus(readTerminalByokProjection(), println);
        return;
    }

    if (sub === 'profiles') {
        println(`\n  \x1b[36mBYOK profiles\x1b[0m (${profiles.length})\n`);
        if (profiles.length === 0) {
            println('    \x1b[33mNenhum perfil configurado em COPILOT_BYOK_PROFILES_JSON no .env.local.\x1b[0m\n');
            return;
        }
        for (const profile of profiles) {
            const active = profile.name === summary.profile ? ' \x1b[32m← ativo\x1b[0m' : '';
            const auth = profile.auth.bearerTokenConfigured
                ? 'bearer'
                : profile.auth.apiKeyConfigured
                  ? 'apiKey'
                  : profile.auth.headersConfigured
                    ? 'headers'
                    : 'none';
            const metadata = profile.metadataKeys.length ? ` · meta=${profile.metadataKeys.join(',')}` : '';
            println(`    \x1b[33m${profile.name}\x1b[0m${active}`);
            println(
                `      \x1b[90mpreset=${profile.preset ?? '-'} · provider=${profile.providerType ?? '-'} · model=${profile.model ?? '-'} · auth=${auth}${metadata}\x1b[0m`,
            );
        }
        println('\n  \x1b[90mUso: /byok use <perfil> para ativar no processo atual; depois /restart para abrir nova sessão SDK.\x1b[0m\n');
        return;
    }

    if (sub === 'models') {
        println(`\n  \x1b[36mBYOK models\x1b[0m (${models.length})\n`);
        if (models.length === 0) {
            println('    \x1b[33mNenhum modelo BYOK configurado. Defina COPILOT_BYOK_MODEL ou COPILOT_BYOK_MODELS.\x1b[0m\n');
            return;
        }
        for (const model of models) {
            const reasoning = model.capabilities?.supports?.reasoningEffort ? 'reasoning' : 'no-reasoning';
            const vision = model.capabilities?.supports?.vision ? 'vision' : 'no-vision';
            const ctxTokens = model.capabilities?.limits?.max_context_window_tokens ?? 'n/a';
            println(`    \x1b[33m${model.id}\x1b[0m  \x1b[90m${reasoning} · ${vision} · ctx=${ctxTokens}\x1b[0m`);
        }
        println('');
        return;
    }

    if (sub === 'use') {
        const target = normalizeArg(rest.join(' '));
        if (!target) {
            println('  \x1b[31mUso: /byok use <perfil|sdk>\x1b[0m\n');
            return;
        }
        if (target === 'sdk' || target === 'off' || target === 'copilot') {
            process.env['COPILOT_BYOK_ENABLED'] = 'false';
            delete process.env['COPILOT_BYOK_PROFILE'];
            println('\n  \x1b[32mBYOK desativado no processo atual; o SDK Copilot volta a governar a próxima sessão.\x1b[0m');
            println('  \x1b[90mUse /restart para reabrir o dialog loop com o SDK sem provider customizado.\x1b[0m\n');
            return;
        }
        if (!profiles.some((profile) => profile.name === target)) {
            println(`  \x1b[31mPerfil BYOK não encontrado: ${target}. Veja /byok profiles.\x1b[0m\n`);
            return;
        }
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        process.env['COPILOT_BYOK_PROFILE'] = target;
        delete process.env['COPILOT_BYOK_MODEL'];
        renderStatus(readTerminalByokProjection(), println);
        return;
    }

    if (sub === 'model') {
        const model = normalizeArg(rest.join(' '));
        if (!model) {
            println('  \x1b[31mUso: /byok model <model-id>\x1b[0m\n');
            return;
        }
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        process.env['COPILOT_BYOK_MODEL'] = model;
        renderStatus(readTerminalByokProjection(), println);
        return;
    }

    if (sub === 'provider') {
        const [preset, model, baseUrl] = rest;
        if (!preset) {
            println('  \x1b[31mUso: /byok provider <preset> [model] [baseUrl]\x1b[0m\n');
            return;
        }
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        delete process.env['COPILOT_BYOK_PROFILE'];
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = preset;
        if (model) process.env['COPILOT_BYOK_MODEL'] = model;
        if (baseUrl) process.env['COPILOT_BYOK_BASE_URL'] = baseUrl;
        renderStatus(readTerminalByokProjection(), println);
        return;
    }

    renderStatus(projection, println);
}
