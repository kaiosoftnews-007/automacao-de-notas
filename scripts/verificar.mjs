#!/usr/bin/env node
// Verificação antes do commit: barra se a extensão mudou e o zip/json publicados não foram refeitos.
//   node scripts/verificar.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [path.join(aqui, 'gerar_zips_extensoes.mjs'), '--conferir'], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('\nVerificação falhou. Suba a version no extensao/manifest.json, rode o gerador e faça o commit de novo.');
  process.exit(1);
}
console.log('Verificação ok.');
