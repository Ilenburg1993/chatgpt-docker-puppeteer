// @ts-check
/**
 * Catálogo canônico de extensões VS Code do workspace.
 *
 * Regra de arquitetura:
 *
 * - `devcontainer`: provisionamento automático deliberadamente enxuto;
 * - `recommended`: baseline + preferências úteis, sem transformá-las em custo obrigatório;
 * - `optional`: capacidades instaláveis sob demanda por perfil;
 * - `hostOnly`: extensões de transporte/remote que pertencem ao VS Code host, não ao Extension Host remoto;
 * - `unwanted`: não recomendadas pelo workspace, mas não necessariamente removíveis;
 * - `prunable`: subconjunto legado/conflitante cuja remoção automática do Extension Host remoto é segura.
 *
 * O DevContainer e `.vscode/extensions.json` são projeções deste catálogo. Execute `npm run vscode:sync` após editar.
 */

/** @param {ReadonlyArray<readonly string[]>} groups */
function unique(...groups) {
    return [...new Set(groups.flat())];
}

export const VSCODE_EXTENSION_PROFILES = Object.freeze({
    foundation: Object.freeze([
        // Cliente LSP oficial do TypeScript 7. O Marketplace ID é histórico: o engine servido é TS7 GA. Remover esta
        // extensão quando o cliente nativo estiver efetivamente bundled no VS Code usado pelo workspace.
        'TypeScriptTeam.native-preview',
        'dbaeumer.vscode-eslint',
        'esbenp.prettier-vscode',
        'ms-azuretools.vscode-containers',
        'ms-vscode.makefile-tools',
        'timonwong.shellcheck',
        'redhat.vscode-yaml',
        'EditorConfig.EditorConfig',
        'Vue.volar',
    ]),
    github: Object.freeze(['github.vscode-github-actions']),
    githubFull: Object.freeze([
        // O VS Code atual pode entregar Copilot Chat como builtin; o instalador reconhece builtins e não duplica capacidade.
        'GitHub.copilot-chat',
        'GitHub.vscode-pull-request-github',
    ]),
    agents: Object.freeze([
        'Anthropic.claude-code',
        'coderabbit.coderabbit-vscode',
        'openai.chatgpt',
        'google.geminicodeassist',
        'HuggingFace.huggingface-vscode-chat',
        'kilocode.kilo-code',
        'sst-dev.opencode',
    ]),
    docs: Object.freeze(['DavidAnson.vscode-markdownlint']),
    docsFull: Object.freeze(['humao.rest-client', 'aaron-bond.better-comments', 'yzhang.markdown-all-in-one']),
    ux: Object.freeze([
        'usernamehw.errorlens',
        'eamodio.gitlens',
        'ms-vscode.powershell',
        'MS-CEINTL.vscode-language-pack-pt-BR',
        'oderwat.indent-rainbow',
    ]),
    python: Object.freeze(['ms-python.python', 'ms-python.vscode-pylance', 'ms-python.debugpy']),
});

// Somente capacidades técnicas necessárias em praticamente toda sessão remota.
export const VSCODE_DEVCONTAINER_EXTENSIONS = Object.freeze(
    unique(VSCODE_EXTENSION_PROFILES.foundation, VSCODE_EXTENSION_PROFILES.github, VSCODE_EXTENSION_PROFILES.docs),
);

// Recomendações podem ser mais amplas que o auto-install sem transformar preferências em processos residentes obrigatórios.
export const VSCODE_RECOMMENDED_EXTENSIONS = Object.freeze(
    unique(
        VSCODE_DEVCONTAINER_EXTENSIONS,
        VSCODE_EXTENSION_PROFILES.githubFull,
        VSCODE_EXTENSION_PROFILES.docsFull,
        VSCODE_EXTENSION_PROFILES.ux,
    ),
);

export const VSCODE_OPTIONAL_EXTENSIONS = Object.freeze(
    unique(
        VSCODE_EXTENSION_PROFILES.agents,
        VSCODE_EXTENSION_PROFILES.githubFull,
        VSCODE_EXTENSION_PROFILES.docsFull,
        VSCODE_EXTENSION_PROFILES.ux,
        VSCODE_EXTENSION_PROFILES.python,
        [
            'PKief.material-icon-theme',
            'gruntfuggly.todo-tree',
            'pflannery.vscode-versionlens',
            'bierner.markdown-preview-github-styles',
            'tintinweb.graphviz-interactive-preview',
            'ryanluker.vscode-coverage-gutters',
            'docker.docker',
            'cmstead.js-codeformer',
            'cmstead.jsrefactor',
            'chris-noring.node-snippets',
            'howardzuo.vscode-npm-dependency',
            'jasonnutter.search-node-modules',
            'ms-azuretools.vscode-docker',
            'ms-vscode.azure-repos',
            'ms-vscode.vscode-github-issue-notebooks',
            'GitHub.github-vscode-theme',
            // Ortografia permanece opt-in: o workspace canônico usa cSpell.enabled=false.
            'streetsidesoftware.code-spell-checker',
            'streetsidesoftware.code-spell-checker-portuguese-brazilian',
        ],
    ),
);

export const VSCODE_HOST_ONLY_EXTENSIONS = Object.freeze([
    'ms-vscode-remote.remote-containers',
    'ms-vscode-remote.vscode-remote-extensionpack',
    'ms-vscode.remote-explorer',
    'GitHub.codespaces',
    'ms-vscode-remote.remote-ssh',
    'ms-vscode-remote.remote-ssh-edit',
    'ms-vscode.remote-server',
    'GitHub.remotehub',
    'ms-vscode.remote-repositories',
    'ms-vscode-remote.remote-wsl',
]);

export const VSCODE_UNWANTED_EXTENSIONS = Object.freeze([
    // Built-ins / TS7 já cobrem estas funções; várias ativam com `*`.
    'christian-kohler.path-intellisense',
    'christian-kohler.npm-intellisense',
    'hbenl.vscode-test-explorer',
    'mhutchie.git-graph',
    'ZainChen.json',
    'MermaidChart.vscode-mermaid-chart',
    'bierner.markdown-mermaid',
    'vscjava.migrate-java-to-azure',
    // Histórico/deprecado/conflitante.
    'ms-vscode.node-debug',
    'ms-vscode.node-debug2',
    'eg2.vscode-npm-script',
    'octref.vetur',
    'formulahendry.auto-close-tag',
    'formulahendry.auto-rename-tag',
    'DotJoshJohnson.xml',
    'fabiospampinato.vscode-highlight',
    'wix.vscode-import-cost',
    'alefragnani.Bookmarks',
    'CoenraadS.bracket-pair-colorizer',
    'CoenraadS.bracket-pair-colorizer-2',
    '2gua.rainbow-brackets',
    'ms-vscode.vscode-typescript-tslint-plugin',
    'formulahendry.code-runner',
    'rangav.vscode-thunder-client',
    'standard.vscode-standard',
    'dbaeumer.jshint',
    'HookyQR.beautify',
    'esbenp.beautify',
    'ms-vscode.live-server',
    'ritwickdey.LiveServer',
    'ms-vscode.sublime-keybindings',
    'ms-vscode.atom-keybindings',
    'vscodevim.vim',
]);

export const VSCODE_PRUNABLE_EXTENSIONS = Object.freeze([
    // Legado ou conflito direto com capacidades canônicas atuais.
    'ms-vscode.node-debug',
    'ms-vscode.node-debug2',
    'eg2.vscode-npm-script',
    'octref.vetur',
    'CoenraadS.bracket-pair-colorizer',
    'CoenraadS.bracket-pair-colorizer-2',
    '2gua.rainbow-brackets',
    'ms-vscode.vscode-typescript-tslint-plugin',
    'standard.vscode-standard',
    'dbaeumer.jshint',
    'HookyQR.beautify',
    'esbenp.beautify',
]);

export function getExtensionProfile(name = 'devcontainer') {
    if (name === 'devcontainer' || name === 'core') return [...VSCODE_DEVCONTAINER_EXTENSIONS];
    if (name === 'optional') return [...VSCODE_OPTIONAL_EXTENSIONS];
    if (name === 'ai') return [...VSCODE_EXTENSION_PROFILES.agents];
    if (name === 'python') return [...VSCODE_EXTENSION_PROFILES.python];
    if (name === 'all') return unique(VSCODE_DEVCONTAINER_EXTENSIONS, VSCODE_OPTIONAL_EXTENSIONS);
    if (Object.hasOwn(VSCODE_EXTENSION_PROFILES, name)) {
        return [...VSCODE_EXTENSION_PROFILES[/** @type {keyof typeof VSCODE_EXTENSION_PROFILES} */ (name)]];
    }
    throw new Error(`Unknown VS Code extension profile: ${name}`);
}

/**
 * Calcula a reconciliação do Extension Host remoto sem confundir extensões opcionais/pessoais com resíduos proibidos. A
 * remoção é opt-in porque este catálogo também pode ser consultado fora de um DevContainer.
 *
 * @param {readonly string[]} installedExtensions
 * @param {{ profile?: string; prune?: boolean; availableExtensions?: readonly string[] }} [options]
 */
export function planExtensionReconciliation(
    installedExtensions,
    { profile = 'core', prune = false, availableExtensions = installedExtensions } = {},
) {
    const target = getExtensionProfile(profile);
    const installedLower = new Set(installedExtensions.map((extension) => extension.toLowerCase()));
    const availableLower = new Set(availableExtensions.map((extension) => extension.toLowerCase()));
    const install = target.filter((extension) => !availableLower.has(extension.toLowerCase()));
    const removable = unique(VSCODE_PRUNABLE_EXTENSIONS, VSCODE_HOST_ONLY_EXTENSIONS);
    const remove = prune ? removable.filter((extension) => installedLower.has(extension.toLowerCase())) : [];
    return { profile, target, install, remove };
}
