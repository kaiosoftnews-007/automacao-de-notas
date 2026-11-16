#!/usr/bin/env node
// Gera /data/<ext>.zip e /data/<ext>.json para a atualização com um clique.
//   node scripts/gerar_zips_extensoes.mjs             -> gera/regrava
//   node scripts/gerar_zips_extensoes.mjs --conferir  -> só confere (sai com erro se estiver desatualizado)
// Determinístico: mesma pasta = mesmo zip byte a byte. Sem dependências (Node 22+).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// AJUSTE AQUI se a estrutura do repositório for diferente.
const EXTENSOES = [
  { nome: 'automacao-notas', pasta: 'extensao', destino: 'web/data' },
];
// Nunca entram no zip (ficam só na pasta do usuário).
const IGNORAR = new Set(['credenciais.json']);

const DATA_DOS = ((2026 - 1980) << 9) | (1 << 5) | 1; // 01/01/2026
const HORA_DOS = 0;

function listar(dirAbs, rel = '') {
  const saida = [];
  for (const nome of fs.readdirSync(path.join(dirAbs, rel))) {
    if (nome.startsWith('.') || IGNORAR.has(nome)) continue;
    const r = rel ? `${rel}/${nome}` : nome;
    const st = fs.statSync(path.join(dirAbs, r));
    if (st.isDirectory()) saida.push(...listar(dirAbs, r));
    else if (st.isFile()) saida.push(r);
  }
  return saida;
}

function montarZip(pastaAbs, prefixo) {
  const arquivos = listar(pastaAbs).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const locais = [], centrais = [];
  let offset = 0;

  for (const rel of arquivos) {
    const dados = fs.readFileSync(path.join(pastaAbs, rel));
    const comp = zlib.deflateRawSync(dados, { level: 9 });
    const crc = zlib.crc32(dados) >>> 0;
    const nome = Buffer.from(`${prefixo}/${rel}`, 'utf8');

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);       // nomes em UTF-8
    lh.writeUInt16LE(8, 8);            // deflate
    lh.writeUInt16LE(HORA_DOS, 10);
    lh.writeUInt16LE(DATA_DOS, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(dados.length, 22);
    lh.writeUInt16LE(nome.length, 26);
    lh.writeUInt16LE(0, 28);
    locais.push(lh, nome, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(HORA_DOS, 12);
    ch.writeUInt16LE(DATA_DOS, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(dados.length, 24);
    ch.writeUInt16LE(nome.length, 28);
    ch.writeUInt32LE(offset, 42);       // demais campos ficam 0
    centrais.push(ch, nome);

    offset += 30 + nome.length + comp.length;
  }

  const central = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(central.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, central, fim]);
}

function montarJson(ext, pastaAbs) {
  const manifest = JSON.parse(fs.readFileSync(path.join(pastaAbs, 'manifest.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) {
    throw new Error(`${ext.nome}: version do manifest.json deve ser X.Y.Z (está "${manifest.version}")`);
  }
  const arqMud = path.join(RAIZ, 'scripts', `mudancas-${ext.nome}.json`);
  const mudancas = fs.existsSync(arqMud) ? JSON.parse(fs.readFileSync(arqMud, 'utf8')) : [];
  if (!Array.isArray(mudancas)) throw new Error(`${arqMud} deve ser uma lista de textos`);
  return JSON.stringify({ versao: manifest.version, mudancas: mudancas.map(String) }, null, 2) + '\n';
}

const conferir = process.argv.includes('--conferir');
let problemas = 0;

for (const ext of EXTENSOES) {
  const pastaAbs = path.join(RAIZ, ext.pasta);
  const destAbs = path.join(RAIZ, ext.destino);
  const zip = montarZip(pastaAbs, ext.pasta);
  const json = montarJson(ext, pastaAbs);
  const arqZip = path.join(destAbs, `${ext.nome}.zip`);
  const arqJson = path.join(destAbs, `${ext.nome}.json`);

  if (conferir) {
    const zipOk = fs.existsSync(arqZip) && fs.readFileSync(arqZip).equals(zip);
    const jsonOk = fs.existsSync(arqJson) && fs.readFileSync(arqJson, 'utf8') === json;
    if (!zipOk || !jsonOk) {
      problemas++;
      console.error(`✗ ${ext.nome}: ${!zipOk ? 'zip' : ''}${!zipOk && !jsonOk ? ' e ' : ''}${!jsonOk ? 'json' : ''} ` +
        `desatualizado(s). Rode: node scripts/gerar_zips_extensoes.mjs`);
    } else {
      console.log(`✓ ${ext.nome}: zip e json em dia`);
    }
  } else {
    fs.mkdirSync(destAbs, { recursive: true });
    fs.writeFileSync(arqZip, zip);
    fs.writeFileSync(arqJson, json);
    console.log(`${ext.nome}: ${path.relative(RAIZ, arqZip)} (${zip.length} bytes), versão ${JSON.parse(json).versao}`);
  }
}

if (problemas) process.exit(1);
