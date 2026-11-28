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

// 3.13.10: nada aqui pode ficar esperando para sempre (a página travava em "Conferindo a pasta…").
const PRAZO_PERMISSAO = 15000;
const PRAZO_BUSCA = 20000;
const MSG_PERMISSAO = 'O Chrome não respondeu ao pedido de permissão da pasta. Procure o aviso do Chrome (pode estar atrás desta janela ou na barra de endereço) e clique em "Permitir"/"Editar arquivos". Se não aparecer, clique em "Escolher outra pasta".';

function comPrazo(promessa, ms, msg) {
  let t;
  return Promise.race([
    promessa,
    new Promise((_, falha) => { t = setTimeout(() => falha(new Error(msg)), ms); }),
  ]).finally(() => clearTimeout(t));
}

async function pedirPermissao(handle) {
  const opc = { mode: 'readwrite' };
  if ((await handle.queryPermission(opc)) === 'granted') return true;
  status('Aguardando você permitir o acesso à pasta no aviso do Chrome…');
  return (await comPrazo(handle.requestPermission(opc), PRAZO_PERMISSAO, MSG_PERMISSAO)) === 'granted';
}

// Pastas que nunca são a da extensão e deixam a busca lenta.
const PULAR = new Set(['node_modules', '.git', 'windows', 'appdata', 'program files', 'program files (x86)', '$recycle.bin', 'system volume information']);

// Procura a pasta da extensão na escolhida ou nas de dentro (até 3 níveis),
// porque o zip extraído costuma criar pastas uma dentro da outra.
async function acharPastaDaExtensao(handle, nivel = 0, limite = Date.now() + PRAZO_BUSCA) {
  if (Date.now() > limite) throw new Error('A pasta escolhida é grande demais para procurar. Escolha direto a pasta que aparece em "Carregado de" em chrome://extensions (a que tem o manifest.json).');
  status(`Procurando o manifest.json em "${handle.name}"…`);
  if (await pastaEhDaExtensao(handle)) return handle;
  if (nivel >= 3) return null;
  try {
    for await (const item of handle.values()) {
      if (item.kind !== 'directory' || PULAR.has(item.name.toLowerCase())) continue;
      const achou = await acharPastaDaExtensao(item, nivel + 1, limite);
      if (achou) return achou;
    }
  } catch (e) {
    if (e && /grande demais/.test(e.message)) throw e;
    /* sem acesso a alguma subpasta: ignora */
  }
  return null;
}

async function escolherPasta() {
  let escolhida;
  try {
    escolhida = await window.showDirectoryPicker({ id: 'automacao-notas', mode: 'readwrite' });
  } catch (e) {
    console.warn('showDirectoryPicker', e);
    if (e && e.name === 'AbortError') {
      throw new Error('A escolha da pasta foi cancelada. Depois de clicar em "Selecionar pasta", o Chrome pergunta se pode editar os arquivos: clique em "Editar arquivos". (detalhe: ' + e.name + ' - ' + e.message + ')');
    }
    throw new Error('O Chrome não abriu a escolha de pasta (detalhe: ' + (e && e.name) + ' - ' + (e && e.message) + ')');
  }
  const handle = await acharPastaDaExtensao(escolhida);
  if (!handle) {
    throw new Error('Não achei o manifest.json da Automação de Notas em "' + escolhida.name + '" nem nas pastas de dentro. Escolha a pasta que aparece em "Carregado de" em chrome://extensions.');
  }
  if (!(await pedirPermissao(handle))) {
    throw new Error('O Chrome não deu permissão para gravar nessa pasta. Tente de novo e clique em "Editar arquivos".');
  }
  await guardarPasta(handle);
  return handle;
}

async function obterPasta(forcarNova) {
  if (!forcarNova) {
    const guardada = await lerPastaGuardada();
    if (guardada) {
      let ok = false;
      try {
        ok = (await pedirPermissao(guardada)) && (await pastaEhDaExtensao(guardada));
      } catch (e) {
        // Prazo estourado: o clique já "passou", então não dá para abrir a escolha de pasta daqui.
        if (e && e.message === MSG_PERMISSAO) throw e;
      }
      if (ok) return guardada;
      status('A pasta guardada não serve mais; escolha a pasta da extensão…');
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

// true se o arquivo já existe na pasta com exatamente o mesmo conteúdo
async function igualAoDaPasta(raiz, caminho, dados) {
  try {
    const partes = caminho.split('/');
    let dir = raiz;
    for (const p of partes.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    const atual = await (await dir.getFileHandle(partes.at(-1))).getFile();
    if (atual.size !== dados.length) return false;
    const b = new Uint8Array(await atual.arrayBuffer());
    for (let i = 0; i < b.length; i++) if (b[i] !== dados[i]) return false;
    return true;
  } catch { return false; }
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

    // 4) grava só o que mudou (cada gravação passa pela verificação do Chrome/antivírus e é lenta);
    //    manifest.json sempre, e por último
    status('Conferindo quais arquivos mudaram…');
    const mudaram = [];
    for (const a of arquivos) {
      if (a !== novoManifest && !(await igualAoDaPasta(pasta, a.rel, a.dados))) mudaram.push(a);
    }
    const total = mudaram.length + 1;
    let n = 0;
    for (const a of mudaram) {
      status(`Gravando arquivos alterados… (${++n}/${total})`);
      await gravar(pasta, a.rel, a.dados);
    }
    status(`Gravando arquivos alterados… (${total}/${total})`);
    await gravar(pasta, 'manifest.json', novoManifest.dados);

    // 5) recarrega
    status(`Pronto: versão ${publicada.versao} instalada. Recarregando a extensão…`, 'ok');
    setTimeout(() => chrome.runtime.reload(), 1500);
  } catch (e) {
    console.warn('atualizar', e);
    status(e && e.message ? (e.name && e.name !== 'Error' ? e.name + ': ' : '') + e.message : String(e), 'erro');
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
