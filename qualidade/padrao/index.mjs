// Configuração ESLint padrão para todos os projetos.
//
// Uso no projeto (eslint.config.mjs):
//
//   import { criarConfig } from "padrao-qualidade";
//
//   export default await criarConfig({
//     typescript: true,
//     src: "src",
//     logger: "o logger do projeto (src/lib/logger.ts)",
//     arquivosDeLog: ["src/lib/logger.ts"],
//   });
//
// Regras do padrão (vindas do vibe-coding-toolkit, licença MIT):
//   - quality/max-lines            -> arquivo de código com no máximo N linhas
//   - quality/no-direct-console    -> nada de console.* fora do adaptador de log
//   - quality/no-direct-data-access -> UI não importa o cliente do banco
//
// Severidades: o padrão é "error". Em projeto que já tem violações, passe
// `emAviso: ["quality/max-lines", "no-unused-vars", ...]` com a contagem atual anotada,
// e volte para "error" quando a contagem chegar a zero.
import js from "@eslint/js";
import globals from "globals";

import quality from "./eslint-rules/index.cjs";

export const MAX_LINES = 350;

const EXT = "{js,jsx,ts,tsx,mjs,cjs,mts,cts}";

const testFiles = [
  `**/*{.,-}{test,spec}.${EXT}`,
  `**/{__tests__,__mocks__,fixtures,mocks}/**/*.${EXT}`,
];

const ignoradosPadrao = [
  "qualidade/**",
  ".claude/**",
  ".github/**",
  ".wrangler/**",
  ".next/**",
  ".vercel/**",
  ".svelte-kit/**",
  "node_modules/**",
  "dist/**",
  "build/**",
  "out/**",
  "coverage/**",
  "**/*.tsbuildinfo",
  "**/*.min.js",
];

/**
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.typescript=false] liga typescript-eslint (exige `typescript` instalado)
 * @param {string|string[]} [opcoes.src="src"] pasta(s) do código da aplicação
 * @param {number} [opcoes.maxLines=350] teto de linhas por arquivo
 * @param {"node"|"browser"|"ambos"} [opcoes.ambiente="ambos"] globais disponíveis
 * @param {string} [opcoes.logger] texto mostrado na mensagem do no-direct-console
 * @param {string[]} [opcoes.arquivosDeLog=[]] arquivos que podem usar console (o próprio logger)
 * @param {{modules: string[], layers: string[], bindings?: string[], extensions?: string[]}|null} [opcoes.acessoADados=null]
 *        configuração do no-direct-data-access; null desliga a regra (projeto sem módulo de banco)
 * @param {string[]} [opcoes.emAviso=[]] regras (quality/* ou não) que ficam em "warn" (linha de base)
 * @param {string[]} [opcoes.maxLinesExcecoes=[]] arquivos fora do teto (exceções conscientes)
 * @param {string[]} [opcoes.ignorar=[]] globs extras a ignorar
 * @param {object[]} [opcoes.extras=[]] blocos de config adicionais, aplicados por último
 */
export async function criarConfig(opcoes = {}) {
  const {
    typescript = false,
    src = "src",
    maxLines = MAX_LINES,
    ambiente = "ambos",
    logger = "o logger do projeto",
    arquivosDeLog = [],
    acessoADados = null,
    emAviso = [],
    maxLinesExcecoes = [],
    ignorar = [],
    extras = [],
  } = opcoes;

  const pastas = Array.isArray(src) ? src : [src];
  const arquivosApp = pastas.map((p) =>
    p === "." ? `**/*.${EXT}` : `${p.replace(/\/$/, "")}/**/*.${EXT}`
  );
  const nivel = (regra) => (emAviso.includes(regra) ? "warn" : "error");

  const globais =
    ambiente === "node"
      ? globals.node
      : ambiente === "browser"
        ? globals.browser
        : { ...globals.node, ...globals.browser };

  const config = [
    { languageOptions: { globals: globais } },
    js.configs.recommended,
  ];

  if (typescript) {
    const { default: tseslint } = await import("typescript-eslint");
    config.push(...tseslint.configs.recommended, {
      // Em TS o próprio compilador já acusa nomes não definidos; no-undef
      // só gera falso positivo com tipos globais (recomendação do typescript-eslint).
      files: ["**/*.{ts,tsx,mts,cts}"],
      rules: { "no-undef": "off" },
    });
  }

  const regrasQualidade = {
    "quality/max-lines": [
      nivel("quality/max-lines"),
      { max: maxLines, ignore: maxLinesExcecoes },
    ],
    "quality/no-direct-console": [nivel("quality/no-direct-console"), { logger }],
  };
  if (acessoADados) {
    regrasQualidade["quality/no-direct-data-access"] = [
      nivel("quality/no-direct-data-access"),
      acessoADados,
    ];
  }

  config.push(
    {
      files: arquivosApp,
      plugins: { quality },
      rules: {
        "no-var": "error",
        "prefer-const": "error",
        "no-empty": ["error", { allowEmptyCatch: true }],
        ...(typescript
          ? {
              "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
              ],
            }
          : {
              "no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
              ],
            }),
        ...regrasQualidade,
      },
    },
    // Linha de base: qualquer regra listada em emAviso (quality/* ou do
    // ESLint/TypeScript) cai para "warn". Só a severidade muda; as opções da
    // regra são mantidas pelo flat config.
    ...(emAviso.length
      ? [
          {
            files: arquivosApp,
            rules: Object.fromEntries(emAviso.map((regra) => [regra, "warn"])),
          },
        ]
      : []),
    // Blocos que DESLIGAM regras vêm depois dos que ligam: no flat config
    // o último bloco que casa com o arquivo vence.
    ...(arquivosDeLog.length
      ? [{ files: arquivosDeLog, rules: { "quality/no-direct-console": "off" } }]
      : []),
    {
      files: testFiles,
      plugins: { quality },
      rules: {
        "quality/max-lines": ["warn", { max: maxLines, includeTests: true }],
      },
    },
    { ignores: [...ignoradosPadrao, ...ignorar] },
    ...extras
  );

  return config;
}

export { quality };
export default criarConfig;
