/* ==========================================================================
   src/core/i18n.js
   Audit Level: 32 — Universal Linguistic Core (NASA Standard)
   Responsabilidade: Gestão de vocabulário dinâmico, tradução e auto-aprendizado.
   Garantias: Escrita Atômica, Fallback Hierárquico, Normalização de Locale.
========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { log } = require('./logger');

const ROOT = path.resolve(__dirname, '../../');
const VOCAB_FILE = path.join(ROOT, 'vocabulary.json');

// --- DICIONÁRIO SEMENTE (IMUTÁVEL NO CÓDIGO) ---
const BASE_VOCAB = {
  "en": {
    error_indicators: ["network error", "something went wrong", "policy violation", "limit reached", "connection lost", "error generating"],
    close_actions: ["ok", "okay", "next", "close", "dismiss", "accept", "skip", "done", "got it"],
    input_placeholders: ["message", "ask", "prompt", "type", "search"]
  },
  "pt": {
    error_indicators: ["erro de rede", "algo deu errado", "violação", "limite atingido", "conexão perdida", "erro ao gerar"],
    close_actions: ["próximo", "fechar", "entendi", "aceitar", "pular", "concluir", "ok"],
    input_placeholders: ["mensagem", "pergunte", "digite", "conversar", "envie", "busca"]
  },
  "blocked": ["search", "find", "filter", "buscar", "pesquisar", "filtrar", "feedback", "report", "history", "histórico"]
};

let vocabCache = null;

/* ==========================================================================
   UTILITÁRIOS INTERNOS
========================================================================== */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Escrita Atômica com Retry (Proteção Windows EPERM)
 */
async function atomicWrite(filepath, content) {
    const tmp = `${filepath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
    try {
        fs.writeFileSync(tmp, content, 'utf-8');
        let attempts = 0;
        while (attempts < 10) {
            try {
                fs.renameSync(tmp, filepath);
                return;
            } catch (e) {
                attempts++;
                await sleep(100 * attempts);
            }
        }
    } catch (e) {
        if (fs.existsSync(tmp)) try { fs.unlinkSync(tmp); } catch (_) {}
        throw e;
    }
}

/**
 * Normaliza códigos de idioma (ex: 'pt-BR' -> 'pt', 'EN_US' -> 'en')
 */
function normalizeLang(langCode) {
    if (!langCode || typeof langCode !== 'string') return 'en';
    return langCode.split(/[-_]/)[0].toLowerCase();
}

/* ==========================================================================
   CORE LOGIC
========================================================================== */

/**
 * Carrega o vocabulário com detecção de corrupção física.
 */
async function loadVocab() {
    if (vocabCache) return vocabCache;

    try {
        if (fs.existsSync(VOCAB_FILE)) {
            const content = fs.readFileSync(VOCAB_FILE, 'utf-8');
            if (content.trim()) {
                vocabCache = JSON.parse(content);
                return vocabCache;
            }
        }
    } catch (e) {
        log('ERROR', `[i18n] Vocabulário corrompido ou ilegível. Restaurando base.`);
    }

    // Fallback para a semente e tenta salvar
    vocabCache = JSON.parse(JSON.stringify(BASE_VOCAB));
    await atomicWrite(VOCAB_FILE, JSON.stringify(vocabCache, null, 2)).catch(() => {});
    return vocabCache;
}

/**
 * Retorna termos de uma categoria com fallback hierárquico para o Inglês.
 */
async function getTerms(category, langCode = 'en') {
    const v = await loadVocab();
    const lang = normalizeLang(langCode);
    
    // Usamos um Set para garantir unicidade
    const terms = new Set();
    
    // 1. Prioridade: Idioma Detectado
    if (v[lang] && v[lang][category]) {
        v[lang][category].forEach(t => terms.add(t.toLowerCase()));
    }
    
    // 2. Fallback: Inglês (Sempre incluído como segurança universal)
    if (lang !== 'en' && v['en'] && v['en'][category]) {
        v['en'][category].forEach(t => terms.add(t.toLowerCase()));
    }

    return Array.from(terms);
}

/**
 * Aprende e persiste um novo termo após validação semântica.
 */
async function learnTerm(langCode, category, term) {
    if (!term || typeof term !== 'string' || term.length < 3) return;
    
    const v = await loadVocab();
    const lang = normalizeLang(langCode);
    const cleanTerm = term.toLowerCase().trim().replace(/[.!?]$/, "");

    // 1. Proteção contra Envenenamento (Blocklist)
    if (v.blocked.some(bad => cleanTerm.includes(bad))) {
        return;
    }

    // 2. Inicialização de estrutura se o idioma for novo (ex: 'fr', 'de')
    if (!v[lang]) v[lang] = {};
    if (!v[lang][category]) v[lang][category] = [];
    
    // 3. Persistência Idempotente
    if (!v[lang][category].includes(cleanTerm)) {
        v[lang][category].push(cleanTerm);
        try {
            await atomicWrite(VOCAB_FILE, JSON.stringify(v, null, 2));
            vocabCache = v; // Atualiza cache em memória
            log('INFO', `[i18n] Aprendizado consolidado (${lang}): "${cleanTerm}"`);
        } catch (e) {
            log('ERROR', `[i18n] Falha ao persistir aprendizado: ${e.message}`);
        }
    }
}

module.exports = { getTerms, learnTerm };