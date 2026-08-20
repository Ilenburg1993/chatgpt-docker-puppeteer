// @ts-check
/**
 * Catálogo canônico de extensões VS Code do workspace.
 *
 * Regra de arquitetura:
 * - `devcontainer`: provisionamento automático e deliberadamente enxuto;
 * - `optional`: capacidades úteis, porém carregadas sob demanda;
 * - `hostOnly`: extensões de transporte/remote que pertencem ao VS Code host, não ao Extension Host remoto;
 * - `unwanted`: redundantes, obsoletas, conflitantes ou com custo conhecido superior ao benefício neste workspace.
 *
 * O DevContainer e `.vscode/extensions.json` são projeções deste catálogo. Execute `npm run vscode:sync` após editar.
 */

/** @param {ReadonlyArray<readonly string[]>} groups */
function unique(...groups) {
    return [...new Set(groups.flat())];
}

export const VSCODE_EXTENSION_PROFILES = Object.freeze({
    foundation: Object.freeze([
        'TypeScriptTeam.native-preview',
        'dbaeumer.vscode-eslint',
        'esbenp.prettier-vscode',
        'usernamehw.errorlens',
        'ms-azuretools.vscode-containers',
        'ms-vscode.makefile-tools',
        'eamodio.gitlens',
        'timonwong.shellcheck',
        'redhat.vscode-yaml',
        'EditorConfig.EditorConfig',
        'ms-vscode.powershell',
        'MS-CEINTL.vscode-language-pack-pt-BR',
        'Vue.volar',
    ]),
    github: Object.freeze([
        'GitHub.copilot',
        'GitHub.copilot-chat',
        'github.vscode-github-actions',
        'GitHub.vscode-pull-request-github',
    ]),
    ai: Object.freeze([
        // Mantidas no perfil automático: ampliar liberdade de escolha de agente é requisito do workspace.
        'Anthropic.claude-code',
        'coderabbit.coderabbit-vscode',
        'openai.chatgpt',
        'google.geminicodeassist',
        'HuggingFace.huggingface-vscode-chat',
        'kilocode.kilo-code',
        'sst-dev.opencode',
    ]),
    docs: Object.freeze([
        'humao.rest-client',
        'aaron-bond.better-comments',
        'yzhang.markdown-all-in-one',
        'DavidAnson.vscode-markdownlint',
    ]),
    python: Object.freeze(['ms-python.python', 'ms-python.vscode-pylance', 'ms-python.debugpy']),
});

export const VSCODE_DEVCONTAINER_EXTENSIONS = Object.freeze(
    unique(
        VSCODE_EXTENSION_PROFILES.foundation,
        VSCODE_EXTENSION_PROFILES.github,
        VSCODE_EXTENSION_PROFILES.ai,
        VSCODE_EXTENSION_PROFILES.docs,
    ),
);

export const VSCODE_OPTIONAL_EXTENSIONS = Object.freeze([
    // Visual / documentação especializada
    'PKief.material-icon-theme',
    'gruntfuggly.todo-tree',
    'pflannery.vscode-versionlens',
    'bierner.markdown-preview-github-styles',
    'tintinweb.graphviz-interactive-preview',
    // Ferramentas especializadas que não justificam ativação em toda sessão
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
    ...VSCODE_EXTENSION_PROFILES.python,
    // Ortografia permanece opt-in: o workspace canônico usa cSpell.enabled=false.
    'streetsidesoftware.code-spell-checker',
    'streetsidesoftware.code-spell-checker-portuguese-brazilian',
]);

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
    'oderwat.indent-rainbow',
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

export const VSCODE_RECOMMENDED_EXTENSIONS = VSCODE_DEVCONTAINER_EXTENSIONS;

export function getExtensionProfile(name = 'devcontainer') {
    if (name === 'devcontainer' || name === 'core') return [...VSCODE_DEVCONTAINER_EXTENSIONS];
    if (name === 'optional') return [...VSCODE_OPTIONAL_EXTENSIONS];
    if (name === 'python') return [...VSCODE_EXTENSION_PROFILES.python];
    if (name === 'all') return unique(VSCODE_DEVCONTAINER_EXTENSIONS, VSCODE_OPTIONAL_EXTENSIONS);
    if (Object.hasOwn(VSCODE_EXTENSION_PROFILES, name)) {
        return [...VSCODE_EXTENSION_PROFILES[/** @type {keyof typeof VSCODE_EXTENSION_PROFILES} */ (name)]];
    }
    throw new Error(`Unknown VS Code extension profile: ${name}`);
}
