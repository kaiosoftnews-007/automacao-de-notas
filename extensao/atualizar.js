// Página de atualização com um clique. Só faz algo quando o usuário clica.
import { SITE, EXT, NUNCA_SOBRESCREVER, maior, buscarPublicada } from './atualizacao-config.js';
import { lerZip } from './lerzip.js';

const MANIFEST = chrome.runtime.getManifest();
const $ = (id) => document.getElementById(id);
let publicada = null;

function status(texto, tipo = '') {
  $('status').textContent = texto;
  $('status').className = tipo;
}

// ---------- IndexedDB: guarda a pasta escolhida ----------
function abrirBanco() {
  return new Promise((ok, falha) => {
    const req = indexedDB.open('automacao-notas', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('pasta');
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
}
async function lerPastaGuardada() {
  try {
    const db = await abrirBanco();
    return await new Promise((ok) => {
      const r = db.transaction('pasta').objectStore('pasta').get('p');
      r.onsuccess = () => ok(r.result || null);
      r.onerror = () => ok(null);
    });
  } catch { return null; }
}
async function guardarPasta(handle) {
  try {
    const db = await abrirBanco();
    await new Promise((ok) => {
      const tx = db.transaction('pasta', 'readwrite');
      tx.objectStore('pasta').put(handle, 'p');
      tx.oncomplete = ok; tx.onerror = ok; tx.onabort = ok;
    });
  } catch { /* segue sem guardar */ }
}

// ---------- Pasta da extensão ----------
async function pastaEhDaExtensao(handle) {
  try {
    const arq = await (await handle.getFileHandle('manifest.json')).getFile();
    const m = JSON.parse(await arq.text());
    return m.name === MANIFEST.name && /^\d+\.\d+\.\d+$/.test(m.version || '');
  } catch { return false; }
}

async function temPermissao(handle) {
  const opc = { mode: 'readwrite' };
  if ((await handle.queryPermission(opc)) === 'granted') return true;
  return (await handle.requestPermission(opc)) === 'granted';
}

async function escolherPasta() {
  const handle = await window.showDirectoryPicker({ id: 'automacao-notas', mode: 'readwrite' });
  if (!(await pastaEhDaExtensao(handle))) {
    throw new Error('Essa pasta não é a da extensão. Escolha a pasta que tem o manifest.json da Automação de Notas.');
  }
  await guardarPasta(handle);
  return handle;
}

async function obterPasta(forcarNova) {
  if (!forcarNova) {
    const guardada = await lerPastaGuardada();
    if (guardada) {
      try {
        if ((await temPermissao(guardada)) && (await pastaEhDaExtensao(guardada))) return guardada;
      } catch { /* cai para pedir a pasta */ }
    }
  }
  return escolherPasta();
}

// ---------- Gravação ----------
async function gravar(raiz, caminho, dados) {
  const partes = caminho.split('/');
  let dir = raiz;
  for (const p of partes.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
  const arq = await dir.getFileHandle(partes.at(-1), { create: true });
  const w = await arq.createWritable();
  await w.write(dados);
  await w.close();
}

async function atualizar(forcarNova) {
  $('atualizar').disabled = $('outra').disabled = true;
  try {
    // 1) pasta (precisa vir antes de qualquer download, ainda dentro do clique)
    status('Conferindo a pasta da extensão…');
    const pasta = await obterPasta(forcarNova);

    // 2) versão publicada
    status('Conferindo a versão publicada…');
    publicada = await buscarPublicada();
    mostrarVersao();
    if (!maior(publicada.versao, MANIFEST.version)) {
      status(`Você já está na versão mais nova (${MANIFEST.version}).`, 'ok');
      return;
    }

    // 3) baixa e abre o zip (tudo na memória; nada é gravado se algo falhar aqui)
    status(`Baixando a versão ${publicada.versao}…`);
    const r = await fetch(`${SITE}/data/${EXT}.zip`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Não consegui baixar a atualização (HTTP ${r.status}).`);
    const entradas = await lerZip(await r.arrayBuffer());

    const arquivos = [];
    for (const { caminho, dados } of entradas) {
      const rel = caminho.split('/').slice(1).join('/'); // tira "<pasta>/"
      if (!rel) continue;
      if (rel.split('/').some((s) => s === '..' || s === '.' || s === '') || rel.includes('\\')) {
        throw new Error(`Caminho inválido no zip: ${caminho}`);
      }
      if (NUNCA_SOBRESCREVER.includes(rel)) continue;
      arquivos.push({ rel, dados });
    }

    const novoManifest = arquivos.find((a) => a.rel === 'manifest.json');
    if (!novoManifest) throw new Error('O zip publicado não tem manifest.json.');
    const m = JSON.parse(new TextDecoder().decode(novoManifest.dados));
    if (m.name !== MANIFEST.name) throw new Error('O zip publicado é de outra extensão.');
    if (m.version !== publicada.versao) {
      throw new Error(`O zip publicado está na versão ${m.version}, mas o aviso diz ${publicada.versao}. Tente mais tarde.`);
    }

    // 4) grava: manifest.json por último
    let n = 0;
    for (const a of arquivos) {
      if (a === novoManifest) continue;
      status(`Gravando arquivos… (${++n}/${arquivos.length})`);
      await gravar(pasta, a.rel, a.dados);
    }
    await gravar(pasta, 'manifest.json', novoManifest.dados);

    // 5) recarrega
    status(`Pronto: versão ${publicada.versao} instalada. Recarregando a extensão…`, 'ok');
    setTimeout(() => chrome.runtime.reload(), 1500);
  } catch (e) {
    if (e && e.name === 'AbortError') status('Nenhuma pasta escolhida.', 'erro');
    else status(e && e.message ? e.message : String(e), 'erro');
  } finally {
    $('atualizar').disabled = $('outra').disabled = false;
  }
}

function mostrarVersao() {
  if (!publicada) return;
  const ha = maior(publicada.versao, MANIFEST.version);
  $('versao').textContent = `Sua versão: ${MANIFEST.version}. Versão publicada: ${publicada.versao} ` +
    (ha ? '(há atualização).' : '(você está em dia).');
  const lista = $('lista');
  lista.textContent = '';
  if (ha && publicada.mudancas.length) {
    for (const item of publicada.mudancas.slice(0, 8)) {
      const li = document.createElement('li');
      li.textContent = String(item).slice(0, 200);
      lista.appendChild(li);
    }
    $('mudancas').hidden = false;
  } else {
    $('mudancas').hidden = true;
  }
}

$('atualizar').addEventListener('click', () => atualizar(false));
$('outra').addEventListener('click', () => atualizar(true));

buscarPublicada()
  .then((p) => { publicada = p; mostrarVersao(); })
  .catch(() => {
    $('versao').textContent = `Sua versão: ${MANIFEST.version}. Não consegui consultar a versão publicada (sem internet?).`;
  });
