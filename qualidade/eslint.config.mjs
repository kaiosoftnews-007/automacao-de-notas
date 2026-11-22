// Config de lint deste projeto. As regras ficam em ./padrao/ (cópia de
// kaiosoftnews-007/padrao-qualidade — não edite lá, edite no repositório padrão
// e rode o script de sincronização). Aqui só se ajustam as opções.
//
// Rodar:  npm --prefix qualidade ci && npm --prefix qualidade run lint
import globals from "globals";

import { criarConfig } from "./padrao/index.mjs";

export default await criarConfig({
  typescript: false,

  // site (web/), extensão do Chrome (extensao/) e scripts de build (scripts/).
  // robo/ é Python e organizador/ é PowerShell: fora do alcance do ESLint.
  src: ["web", "extensao", "scripts"],

  ambiente: "browser",

  // Ainda não existe um logger no projeto. Os scripts de linha de comando
  // (scripts/) escrevem no terminal de propósito, então podem usar console.
  logger: "um helper de log do projeto",
  arquivosDeLog: ["scripts/**"],

  // O web/app.js cria o cliente Supabase direto (não há camada de dados
  // separada), então a regra de acesso a dados não se aplica por enquanto.
  acessoADados: null,

  // Linha de base medida em 2026-11-22 (etapa 1). Cada regra volta para erro
  // quando a contagem dela chegar a zero (etapas 2 e 3).
  emAviso: [
    "quality/max-lines", //          3 (web/app.js 1664, extensao/background.js 627, extensao/content.js 417)
    "quality/no-direct-console", // 13
    "no-unused-vars", //            20
    "no-useless-escape", //          3
    "preserve-caught-error", //      2
    "no-useless-assignment", //      1
  ],

  extras: [
    {
      files: ["extensao/**/*.js"],
      languageOptions: { globals: { ...globals.webextensions } },
    },
    {
      files: ["scripts/**/*.mjs"],
      languageOptions: { globals: { ...globals.node } },
    },
  ],
});
