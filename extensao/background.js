// Fala com o painel (Supabase) usando o login do site e dá nome/pasta aos ZIPs baixados.
const URL_SB = 'https://ankmyrxwxaevxmorfedd.supabase.co';
const CHAVE = 'sb_publishable_t18I7bwPJR3vH25OhbfpDA_dB99c4sR';
const get = (k) => new Promise(r => chrome.storage.local.get(k, r));
const set = (o) => new Promise(r => chrome.storage.local.set(o, r));

async function auth(corpo, tipo) {
  const r = await fetch(`${URL_SB}/auth/v1/token?grant_type=${tipo}`, {
    method: 'POST', headers: { apikey: CHAVE, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'Login recusado');
  const sessao = { access: j.access_token, refresh: j.refresh_token, expira: Date.now() + (j.expires_in - 60) * 1000, email: j.user?.email };
  await set({ sessao });
  return sessao;
}

// Login fixo opcional: arquivo credenciais.json (fica só no seu computador, nunca vai para o GitHub).
let LOGIN_FIXO = null;
const fixoPronto = fetch(chrome.runtime.getURL('credenciais.json')).then(r => r.ok ? r.json() : null)
  .then(c => { if (c?.email && c?.senha) LOGIN_FIXO = c; }).catch(() => {});
const entrarFixo = () => auth({ email: LOGIN_FIXO.email, password: LOGIN_FIXO.senha }, 'password');

async function token() {
  await fixoPronto;
  let { sessao } = await get('sessao');
  if (!sessao) {
    if (!LOGIN_FIXO) throw new Error('Entre com o login do painel (ícone da extensão).');
    sessao = await entrarFixo();
  }
  if (Date.now() > sessao.expira) {
    // O login que veio do painel não é renovado aqui (renovar derrubaria o login do próprio painel).
    if (sessao.doPainel && !LOGIN_FIXO) throw new Error('o login do painel expirou: abra o painel neste Chrome e aperte F5.');
    if (sessao.doPainel) sessao = await entrarFixo();
    else sessao = await auth({ refresh_token: sessao.refresh }, 'refresh_token').catch(e => { if (LOGIN_FIXO) return entrarFixo(); throw e; });
  }
  return sessao.access;
}

async function api({ metodo = 'GET', caminho, corpo, prefer }) {
  const r = await fetch(`${URL_SB}/rest/v1/${caminho}`, {
    method: metodo,
    headers: { apikey: CHAVE, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

chrome.runtime.onMessage.addListener((m, remetente, responder) => {
  (async () => {
    await fixoPronto;
    if (m.tipo === 'atualizarAgora') return abrirAtualizar();
    if (m.tipo === 'login') return auth({ email: m.email, password: m.senha }, 'password').then(s => ({ email: s.email }));
    if (m.tipo === 'sessaoDoPainel') {
      const { sessao } = await get('sessao');
      if (LOGIN_FIXO && sessao && !sessao.doPainel) return true;   // já tem login próprio, que se renova sozinho
      if (!sessao || sessao.email !== m.email || sessao.expira < m.expira)
        await set({ sessao: { access: m.access, refresh: m.refresh, expira: m.expira, email: m.email, doPainel: true } });
      return true;
    }
    if (m.tipo === 'garantirSessao') { const { sessao } = await get('sessao'); if (!sessao && LOGIN_FIXO) await entrarFixo(); return true; }
    if (m.tipo === 'sair') return set({ sessao: null });
    if (m.tipo === 'api') { if (/^downloads/.test(m.caminho || '') && m.metodo && m.metodo !== 'GET') marcarVerificacao(false); return api(m); }
    if (m.tipo === 'nomeDownload') {
      if (m.dl) await mudarZips(z => { z[m.dl] = { em: Date.now() }; });   // 3.9.1: acompanha este ZIP até chegar na pasta
      return set({ proximoNome: { nome: m.nome, dl: m.dl || null, ate: Date.now() + 120000 } });
    }
    if (m.tipo === 'executar') return executar(m);
    if (m.tipo === 'salvarPc') return salvarPc(m.nome);
    if (m.tipo === 'lerPc') { const { pc, pcExcluido } = await get(['pc', 'pcExcluido']); return pc || (pcExcluido ? { excluido: pcExcluido } : null); }
    if (m.tipo === 'focar') {   // login da Sefaz pediu verificação: avisa sem tirar você da aba em que está
      marcarVerificacao(true);
      await alertar(remetente.tab, 'Sefaz: falta a verificação no login', 'CPF e senha já estão preenchidos. Faça a verificação e clique em Autenticar.');
      return true;
    }
    if (m.tipo === 'irPara') { if (remetente.tab?.id) await chrome.tabs.update(remetente.tab.id, { url: m.url }); return true; }
    // A Sefaz estava aberta com o contador de outro escritório: apaga o login guardado da Sefaz neste Chrome
    // (menos o da verificação da Cloudflare) e volta ao portal para entrar com o contador certo.
    if (m.tipo === 'trocarContador') {
      const tabId = remetente.tab?.id;
      await set({ sessaoSefaz: null, login: {}, idas: {}, cliques: {}, cliquesCard: {}, captcha: {} });
      if (!tabId) return true;
      // 1) Sai pelo botão "Sair" da própria Sefaz: só assim a sessão do Acesso Restrito é encerrada no servidor
      //    (apagar cookies não bastava: o Acesso Restrito continuava com o contador antigo).
      const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func: () => {
        const el = [...document.querySelectorAll('a,button,span,li')]
          .filter(e => (e.offsetParent || e.getClientRects().length) && /^\s*Sair\s*$/i.test(e.innerText || ''))
          .sort((a, b) => (a.tagName === 'A' ? -1 : 0) - (b.tagName === 'A' ? -1 : 0))[0];
        if (!el) return false;
        window.confirm = () => true;          // se a Sefaz perguntar "deseja sair?"
        (el.closest('a') || el).click();
        return true;
      } }).catch(() => [{}]);
      if (r?.result) return true;
      // 2) Sem botão Sair na tela (portal): apaga os cookies de login da Sefaz (menos os da Cloudflare) e volta ao portal.
      const cs = await chrome.cookies.getAll({ domain: 'sefaz.go.gov.br' });
      await Promise.all(cs.filter(c => !/^(cf_|__cf)/i.test(c.name)).map(c =>
        chrome.cookies.remove({ url: `https://${c.domain.replace(/^\./, '')}${c.path}`, name: c.name, storeId: c.storeId }).catch(() => {})));
      await chrome.tabs.update(tabId, { url: 'https://portal.sefaz.go.gov.br/portalsefaz-apps/' });
      return true;
    }
    if (m.tipo === 'credSefaz') {
      // 3.12.0: login do contador da empresa (contador_id); sem contador, o login do escritório.
      // Sem contador_id na mensagem: usa o contador da vez (gravado pelo content.js / executar).
      let cont = m.contador_id;
      if (cont === undefined) { const { contadorAtual: ca } = await get('contadorAtual'); cont = ca?.escritorio_id === m.escritorio_id ? ca.id : null; }
      const r = await api({ metodo: 'POST', caminho: 'rpc/extensao_obter_credencial', corpo: { p_escritorio: m.escritorio_id, p_contador: cont || null } });
      return r?.[0] ? { cpf: String(r[0].cpf).replace(/\D/g, ''), senha: r[0].senha } : null;
    }
    if (m.tipo === 'preencherLogin') {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: remetente.tab.id, frameIds: [remetente.frameId ?? 0] }, world: 'MAIN', args: [m.cpf, m.senha],
        func: (cpf, senha) => {
          const vis = e => !!(e && (e.offsetParent || e.getClientRects().length));
          const ev = e => ['input', 'change', 'keyup', 'blur'].forEach(t => e.dispatchEvent(new Event(t, { bubbles: true })));
          const textos = [...document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio])')].filter(vis);
          const u = document.querySelector('#username') || textos.find(e => /cpf|user/i.test(e.placeholder + e.name + e.id)) || textos[0];
          const p = document.querySelector('#password') || [...document.querySelectorAll('input[type=password]')].find(vis);
          if (u && !u.readOnly && !u.disabled) {
            u.focus();
            if (u.inputmask) u.inputmask.setValue(cpf);
            else if (window.jQuery?.fn?.inputmask) window.jQuery(u).inputmask('setvalue', cpf);
            else { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(u, cpf); u.dispatchEvent(new InputEvent('input', { bubbles: true, data: cpf, inputType: 'insertText' })); }
            ev(u);
          }
          // Setter nativo: a tela de login é feita em framework (React/Angular) e "p.value = x" não chega ao
          // estado da página — ela enviava a senha vazia e a Sefaz respondia "Usuário ou Senha inválidos".
          const nativo = (e, v) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, v);
          if (p) { p.focus(); nativo(p, ''); ev(p); nativo(p, senha); p.dispatchEvent(new InputEvent('input', { bubbles: true, data: senha, inputType: 'insertText' })); ev(p); }
          const lido = u ? (u.inputmask?.unmaskedvalue?.() ?? u.value).replace(/\D/g, '') : cpf;
          return { cpfOk: !u || u.readOnly || lido === cpf, senhaOk: !!p && p.value === senha };
        },
      });
      return r?.result;
    }
    if (m.tipo === 'gravarDestino') {
      await chrome.downloads.download({ url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(m.texto), filename: m.nome, conflictAction: 'overwrite', saveAs: false });
      return true;
    }
    if (m.tipo === 'clicar') {
      await chrome.scripting.executeScript({ target: { tabId: remetente.tab.id, frameIds: [remetente.frameId ?? 0] }, world: 'MAIN',
        func: () => {
          const e = document.querySelector('[data-an-clicar]');
          if (!e) return;
          const modoCard = e.getAttribute('data-an-clicar') === 'card';
          e.removeAttribute('data-an-clicar');
          // O que abriria em janela nova (bloqueada como pop-up) abre nesta mesma aba.
          if (!window.__anAbrirAqui) {
            window.__anAbrirAqui = true;
            const original = window.open;
            window.open = (url, alvo, ...resto) => {
              if (url && url !== 'about:blank') { location.href = new URL(url, location.href).href; return window; }
              return original.call(window, url, alvo, ...resto);
            };
          }
          document.querySelectorAll('a[target], form[target]').forEach(x => { if (x.target !== '_self') x.target = '_self'; });
          if (!modoCard) { e.click(); return; }
          // Card inteiro (sobe até um bloco de tamanho de card)
          let card = e;
          while (card.parentElement && card.getBoundingClientRect().height < 80 && card.parentElement !== document.body) card = card.parentElement;
          // 1) Link de verdade dentro do card ou acima dele: vai direto
          const link = [card, ...card.querySelectorAll('a[href]')].map(x => x.closest?.('a[href]') || (x.matches?.('a[href]') ? x : null)).find(Boolean);
          const href = link?.getAttribute('href') || '';
          if (href && !/^(#|javascript:)/i.test(href)) { location.href = new URL(href, location.href).href; return; }
          // 2) Clique completo de mouse no centro do card (o card pode reagir a mousedown/mouseup)
          card.scrollIntoView({ block: 'center' });
          const r = card.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 40);
          const alvo = document.elementFromPoint(x, y) || e;
          const op = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
          for (const tipo of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            const Ev = tipo.startsWith('pointer') ? PointerEvent : MouseEvent;
            alvo.dispatchEvent(new Ev(tipo, { ...op, buttons: /down/.test(tipo) ? 1 : 0 }));
          }
          if (href && /^javascript:/i.test(href)) link.click();   // reserva: link javascript: do próprio site
        } });
      return true;
    }
    if (m.tipo === 'verificacao') {
      marcarVerificacao(true);
      await alertar(remetente.tab, 'Sefaz: confirme que é humano', 'Marque a caixinha "Confirme que é humano" na aba da Sefaz. Depois eu continuo sozinho.');
      return true;
    }
    if (m.tipo === 'verificacaoOk') { marcarVerificacao(false); await limparAlerta(); return true; }
    if (m.tipo === 'irVerificacao') { await irParaSefaz(); return true; }
    if (m.tipo?.startsWith('df')) return mensagemDf(m, remetente);
    if (m.tipo === 'avisar') return chrome.notifications.create({ type: 'basic', iconUrl: 'icone.png', title: 'Automação de Notas', message: m.texto });
  })().then(ok => responder({ ok }), e => responder({ erro: e.message }));
  return true;
});

// O ZIP do histórico da Sefaz vai para Downloads\Notas Sefaz\<empresa>\<mês>\<Entrada|Saida>\
const nomesDf = new Map();   // 3.13.5: url do pacote do DF -> nome com a guia de pasta
chrome.downloads.onDeterminingFilename.addListener((item, sugerir) => {
  const nDf = nomesDf.get(item.url) || nomesDf.get(item.finalUrl);
  if (nDf) { sugerir({ filename: nDf, conflictAction: 'uniquify' }); return; }   // sem isso o Chrome usa o nome do DF e salva solto em Downloads
  if (!/sefaz\.go\.gov\.br/.test(item.url + ' ' + (item.referrer || ''))) return;
  get('proximoNome').then(({ proximoNome: p }) => {
    if (p && Date.now() < p.ate) { set({ proximoNome: null }); if (p.dl) mudarZips(z => { if (z[p.dl]) z[p.dl].id = item.id; }); sugerir({ filename: p.nome, conflictAction: 'uniquify' }); }
    else sugerir();
  });
  return true;
});

// ---- Aviso de verificação: notificação do Windows + "!" vermelho no ícone + faixa vermelha nas abas do painel.
// Nada disso muda a aba em que você está; só leva para a Sefaz se você clicar.
const PAINEL = 'https://automacao-de-notas.denise-vaz1541.workers.dev/*';
async function alertar(aba, titulo, texto) {
  if (aba) await set({ abaVerificacao: { tab: aba.id, janela: aba.windowId } });
  chrome.action.setBadgeText({ text: '!' }); chrome.action.setBadgeBackgroundColor({ color: '#B3261E' });
  chrome.notifications.create('verificacao', { type: 'basic', iconUrl: 'icone.png', requireInteraction: true, priority: 2,
    title: titulo, message: texto + ' (clique aqui para ir até a aba)' });
  for (const t of await chrome.tabs.query({ url: PAINEL }))
    chrome.scripting.executeScript({ target: { tabId: t.id }, args: [titulo, texto], func: (titulo, texto) => {
      let f = document.getElementById('an-alerta');
      if (!f) { f = document.createElement('div'); f.id = 'an-alerta'; document.body.appendChild(f); }
      f.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#B3261E;color:#fff;font:15px Arial;padding:12px 16px;display:flex;gap:14px;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3)';
      f.innerHTML = '';
      const t = document.createElement('span'); t.innerHTML = '<b></b> — '; t.querySelector('b').textContent = titulo; t.append(texto);
      const b = document.createElement('button'); b.textContent = 'Ir para a aba da Sefaz';
      b.style.cssText = 'background:#fff;color:#B3261E;border:0;border-radius:6px;padding:7px 12px;font:bold 14px Arial;cursor:pointer';
      b.onclick = () => chrome.runtime.sendMessage({ tipo: 'irVerificacao' });
      f.append(t, b);
    } }).catch(() => {});
}
async function limparAlerta() {
  chrome.action.setBadgeText({ text: '' }); chrome.notifications.clear('verificacao');
  for (const t of await chrome.tabs.query({ url: PAINEL }))
    chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => document.getElementById('an-alerta')?.remove() }).catch(() => {});
}
async function irParaSefaz() {
  const { abaVerificacao: a } = await get('abaVerificacao');
  if (a) { await chrome.windows.update(a.janela, { focused: true }); await chrome.tabs.update(a.tab, { active: true }); }
}
chrome.notifications.onClicked.addListener(async id => { if (id === 'verificacao') { await irParaSefaz(); chrome.notifications.clear(id); } });

// Quando a extensão é instalada ou atualizada, o Chrome não liga ela nas abas do painel que já estavam abertas
// (o clique em Baixar dizia "Instale a extensão"). Aqui ela se liga nessas abas sozinha.
chrome.runtime.onInstalled.addListener(async () => {
  const abas = await chrome.tabs.query({ url: 'https://automacao-de-notas.denise-vaz1541.workers.dev/*' });
  for (const aba of abas) chrome.scripting.executeScript({ target: { tabId: aba.id }, files: ['painel.js'] }).catch(() => {});
});


// ================= 3.8.0: baixar em outro computador =================
// Este computador se cadastra no painel (com o nome dado no ícone da extensão), dá sinal a cada minuto
// e pega sozinho os pedidos que alguém fez para ele no painel, de qualquer máquina.
// O download em si é o mesmo do clique em "Baixar" (função executar).
const SEFAZ_INICIO = 'https://portal.sefaz.go.gov.br/portalsefaz-apps/';

async function executar(m) {
  // 3.13.0: empresas DF (por CNPJ) vão para o Agênci@Net; as de Goiás seguem o caminho de sempre.
  const { go, df } = await separarUf(m).catch(() => ({ go: 1, df: [] }));
  if (df.length) await solicitarDf(m, df, !go);
  if (!go && df.length) return true;
  await set({ pedido: { escritorio_id: m.escritorio_id, execucao_id: m.execucao_id, ie: m.ie || null, comp: m.comp || null, em: Date.now() } });
  // Abre a Sefaz numa aba em segundo plano: você continua na página em que está.
  if (!m.abriu) {
    try { await chrome.tabs.create({ url: SEFAZ_INICIO, active: false }); }   // abre ao lado, sem tirar você da aba
    catch (_) { await chrome.windows.create({ url: SEFAZ_INICIO, focused: false }); }   // Chrome aberto sem nenhuma janela
  }
  const [esc] = await api({ caminho: `escritorios?select=id,nome&id=eq.${m.escritorio_id}` });
  if (!esc) throw new Error('este login da extensão não enxerga o escritório. Entre na extensão com o mesmo login do painel.');
  await set({ escritorio: esc, contadorAtual: { escritorio_id: m.escritorio_id, id: await primeiroContador(m) } });
  return true;
}

// 3.12.0: contadores por empresa. A fila do content.js vai na ordem do contador (FILA_ORDEM); o primeiro
// login na Sefaz já é o do contador da primeira empresa da fila.
async function primeiroContador(m) {
  try {
    const ies = String(m.ie || '').split(/[,;\s]+/).map(x => x.replace(/\D/g, '')).filter(Boolean);
    const filtroIe = ies.length ? `&ie=in.(${ies.join(',')})` : '';
    const emps = await api({ caminho: `empresas?select=contador_id&escritorio_id=eq.${m.escritorio_id}&ativa=eq.true&ie=not.is.null&ie=neq.&order=contador_id.asc.nullsfirst,razao_social.asc${filtroIe}` }) || [];
    // Prefere o primeiro contador que já tem CPF e senha no painel (os sem login viram erro na fila, sem entrar na Sefaz).
    const comLogin = new Set((await api({ caminho: `contadores?select=id&escritorio_id=eq.${m.escritorio_id}&cpf=not.is.null&senha_secret_id=not.is.null` }) || []).map(c => c.id));
    const e = emps.find(x => !x.contador_id || comLogin.has(x.contador_id)) || emps[0];
    return e?.contador_id || null;
  } catch (_) { return null; }
}

async function cadastrarPc(nome) {
  const [pc] = await api({ metodo: 'POST', caminho: 'computadores?select=id,nome', prefer: 'return=representation',
    corpo: { nome, versao: chrome.runtime.getManifest().version, ultimo_sinal: new Date().toISOString() } });
  await set({ pc: { id: pc.id, nome: pc.nome }, pcExcluido: null });
  await ligarRemocao();
  return pc;
}

// Ao remover a extensão do Chrome, o Chrome abre esta página do painel, que tira o computador da lista.
async function ligarRemocao() {
  try {
    const { pc } = await get('pc');
    if (!pc?.id) { chrome.runtime.setUninstallURL(''); return; }
    let chave = pc.chave;
    if (!chave) {
      const [c] = await api({ caminho: `computadores_chave?select=chave&pc_id=eq.${pc.id}` }) || [];
      if (!c) return;
      chave = c.chave; await set({ pc: { ...pc, chave } });
    }
    chrome.runtime.setUninstallURL(`https://automacao-de-notas.denise-vaz1541.workers.dev/#/removida?pc=${pc.id}&k=${chave}`);
  } catch (e) { console.warn('ligarRemocao:', e.message); }
}
async function salvarPc(nome) {
  nome = String(nome || '').trim().toUpperCase().slice(0, 40);
  if (!nome) throw new Error('Digite um nome para este computador (ex.: PC-ESCRITORIO).');
  await fixoPronto;
  const { pc } = await get('pc');
  if (pc?.id) {
    const r = await api({ metodo: 'PATCH', caminho: `computadores?id=eq.${pc.id}&select=id`, prefer: 'return=representation', corpo: { nome } });
    if (r?.length) { await set({ pc: { ...pc, nome } }); sinal(); return { id: pc.id, nome }; }
  }
  const novo = await cadastrarPc(nome); sinal(); return novo;
}

let verifLigada = null;
async function marcarVerificacao(parado) {
  if (verifLigada === parado) return;
  const { pc } = await get('pc'); if (!pc?.id) return;
  verifLigada = parado;
  api({ metodo: 'PATCH', caminho: `computadores?id=eq.${pc.id}`, corpo: { verificacao_desde: parado ? new Date().toISOString() : null } }).catch(() => { verifLigada = null; });
}

async function ocupado() {
  const { pedido, exec } = await get(['pedido', 'exec']);
  if (pedido && Date.now() - (pedido.em || 0) < 60 * 60e3) return true;                 // pedido abrindo a Sefaz
  if (exec?.rodando && Date.now() - (exec.atualizado || 0) < 2 * 3600e3) return true;   // download em andamento
  return false;
}

let sinalRodando = false;
async function sinal() {
  if (sinalRodando) return; sinalRodando = true;
  try {
    await fixoPronto;
    const { pc } = await get('pc'); if (!pc?.id) return;   // sem nome: este computador não entra na lista
    const r = await api({ metodo: 'PATCH', caminho: `computadores?id=eq.${pc.id}&select=id`, prefer: 'return=representation',
      corpo: { ultimo_sinal: new Date().toISOString(), versao: chrome.runtime.getManifest().version, atualizacao: await textoAtualizacao() } });
    if (!r?.length) {   // foi excluído no painel: sai da lista até alguém salvar um nome de novo no ícone da extensão
      await set({ pc: null, pcExcluido: pc.nome }); chrome.runtime.setUninstallURL(''); return;
    }
    if (!pc.chave) ligarRemocao();
    if (await ocupado()) return;
    // Rotina automática (semanal ou mensal) dos escritórios que escolheram este computador.
    await api({ metodo: 'POST', caminho: 'rpc/extensao_agendar', corpo: { p_pc: pc.id } }).catch(e => console.warn('agendar:', e.message));
    const [p] = await api({ metodo: 'POST', caminho: 'rpc/extensao_pegar_pedido', corpo: { p_pc: pc.id } }) || [];
    if (!p) return;
    await executar({ escritorio_id: p.escritorio_id, execucao_id: p.id, ie: p.ie, comp: p.competencia });
    chrome.notifications.create({ type: 'basic', iconUrl: 'icone.png', title: 'Automação de Notas',
      message: 'Download pedido pelo painel começou neste computador (aba da Sefaz em segundo plano).' });
  } catch (e) { console.warn('sinal:', e.message); }
  finally { sinalRodando = false; }
}

chrome.alarms.create('sinal', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'sinal') { sinal(); conferirZips(); } });
chrome.runtime.onStartup.addListener(() => { sinal(); ligarRemocao(); });
fixoPronto.then(ligarRemocao);
sinal();


// ================= 3.9.1: só marca "Concluído" quando o ZIP chegou na pasta =================
// Antes o painel marcava OK antes de o download terminar. Agora cada ZIP é acompanhado:
//   1) o Chrome terminou de baixar?  2) o organizador tirou o arquivo de Downloads\Notas Sefaz\_organizar?
// Só então o download vira "Concluído". Se o Chrome interromper, ou o organizador não mover em 10 min
// (organizador parado, pasta ou unidade G: fora do ar), vira "Erro" com o motivo. Se o arquivo for
// movido depois, o painel se corrige sozinho para "Concluído".
const MSG_MOVENDO = 'ZIP baixado. Aguardando o organizador mover para a pasta da empresa...';
const MSG_PARADO = 'O ZIP foi baixado, mas não chegou na pasta da empresa: o organizador está parado ou a pasta (unidade G:) não está acessível. O arquivo está em Downloads\\Notas Sefaz\\_organizar.';
let filaZips = Promise.resolve();
function mudarZips(fn) {
  filaZips = filaZips.then(async () => { const { zips } = await get('zips'); const z = zips || {}; try { await fn(z); } finally { await set({ zips: z }); } })
    .catch(e => console.warn('zips:', e.message));
  return filaZips;
}
const marcarDl = (dl, corpo) => api({ metodo: 'PATCH', caminho: `downloads?id=eq.${String(dl).split(':')[0]}`, corpo: { ...corpo, atualizado_em: new Date().toISOString() } });

async function baixou(z, dl) { z[dl].fim = Date.now(); await marcarDl(dl, { status: 'processando', mensagem: MSG_MOVENDO }); }

chrome.downloads.onChanged.addListener(d => {
  const estado = d.state?.current;
  if (estado !== 'complete' && estado !== 'interrupted') return;
  mudarZips(async z => {
    const dl = Object.keys(z).find(k => z[k].id === d.id); if (!dl) return;
    if (estado === 'complete') return baixou(z, dl);
    await marcarDl(dl, { status: 'erro', mensagem: 'O Chrome não terminou de baixar o ZIP (download interrompido). Baixe de novo.' });
    delete z[dl];
  }).then(() => setTimeout(conferirZips, 15e3));   // o organizador olha a pasta a cada 5 s
});

function conferirZips() {
  return mudarZips(async z => {
    for (const [dl, e] of Object.entries(z)) {
      const item = e.id != null ? (await chrome.downloads.search({ id: e.id }))[0] : null;
      if (!e.fim) {
        if (item?.state === 'complete') await baixou(z, dl);
        else if (Date.now() - e.em > (e.id != null ? 30 : 3) * 60e3) {
          await marcarDl(dl, { status: 'erro', mensagem: e.id != null ? 'O ZIP não terminou de baixar em 30 minutos. Baixe de novo.' : 'O Chrome não começou o download do ZIP. Baixe de novo.' });
          delete z[dl];
        }
        continue;
      }
      if (!item || !item.exists) { if (!(await dfPendente(dl))) await marcarDl(dl, { status: 'concluido', mensagem: null }); delete z[dl]; continue; }   // saiu de _organizar: chegou na pasta
      if (!e.avisado && Date.now() - e.fim > 10 * 60e3) { await marcarDl(dl, { status: 'erro', mensagem: MSG_PARADO }); e.avisado = true; }
      if (Date.now() - e.fim > 7 * 24 * 3600e3) delete z[dl];
    }
  });
}
conferirZips();


// ================= 3.11.3: atualização pela página atualizar.html (modelo SGD Integra) =================
// O painel (Atualizações → "Atualizar este computador agora") e o popup abrem atualizar.html.
// Na 1ª vez escolhe-se a pasta da extensão (fica guardada); nas próximas é só clicar em Atualizar agora.
// (A atualização pelo organizador da 3.11.0–3.11.2 foi desligada a pedido do Kaio.)
async function textoAtualizacao() { return null; }
function abrirAtualizar() { return chrome.tabs.create({ url: chrome.runtime.getURL('atualizar.html') }).then(() => 'Abrindo a página de atualização da extensão…'); }
chrome.storage.local.remove('atu'); chrome.alarms.clear('atualizacao');


// ================= 3.13.0: Sefaz DF (Agênci@Net / DEC, acesso por certificado) =================
// O pedido do painel separa as empresas por UF. As do DF (pelo CNPJ) viram 4 pedidos cada
// (NF-e/NFC-e × Emitente/Destinatário, conforme o cadastro) na fila do DEC. O DF demora (até 2 dias)
// para liberar: a cada 5 min a extensão abre o Agênci@Net em segundo plano, baixa o que ficou pronto
// e salva com as mesmas regras de pasta de Goiás (EMPRESA\NOTAS\MMAAAA).
const DF_BASE = 'https://www2.agencianet.fazenda.df.gov.br';
const DF_DEC = DF_BASE + '/DEC/#/';
const soDig = t => String(t || '').replace(/\D/g, '');
const brData = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const PEND_DF = ['a_solicitar', 'solicitado'];

let filaDf = Promise.resolve();
function mudarDf(fn) {
  const p = filaDf.then(async () => { const { df } = await get('df'); const d = df?.itens ? df : { itens: [] }; try { return await fn(d); } finally { await set({ df: d }); } });
  filaDf = p.catch(e => console.warn('df:', e.message));
  return p;
}
async function dfPendente(chave) {
  if (!String(chave).includes(':')) return false;
  const dl = String(chave).split(':')[0];
  const { df } = await get('df');
  return !!df?.itens?.some(i => i.dl === dl && PEND_DF.includes(i.estado));
}

async function separarUf(m) {
  const emps = await api({ caminho: `empresas?select=id,razao_social,codigo,cnpj,ie,uf,pasta,baixar_entrada,baixar_saida,modelo&escritorio_id=eq.${m.escritorio_id}&ativa=eq.true` }) || [];
  const ids = String(m.ie || '').split(/[,;\s]+/).map(soDig).filter(Boolean);
  const esc = emps.filter(e => !ids.length || ids.includes(soDig(e.ie)) || ids.includes(soDig(e.cnpj)));
  const ehDf = e => String(e.uf || '').toUpperCase() === 'DF';
  return { go: esc.filter(e => !ehDf(e) && soDig(e.ie)).length, df: esc.filter(e => ehDf(e) && soDig(e.cnpj).length >= 11) };
}

async function solicitarDf(m, emps, soDf) {
  const rot = (await api({ caminho: `rotinas?select=periodo,pasta_destino&escritorio_id=eq.${m.escritorio_id}` }).catch(() => []))?.[0];
  const h = new Date(), atual = rot?.periodo === 'mes_atual';
  let ini = new Date(h.getFullYear(), h.getMonth() - (atual ? 0 : 1), 1);
  let fim = atual ? h : new Date(h.getFullYear(), h.getMonth(), 0);
  const mc = String(m.comp || '').match(/^(\d{4})-(\d{2})/);
  if (mc) { ini = new Date(+mc[1], +mc[2] - 1, 1); const u = new Date(+mc[1], +mc[2], 0); fim = u > h ? h : u; }
  const comp = `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}-01`;
  const novos = [];
  const { df } = await get('df');
  const ja = df?.itens || [];
  for (const e of emps) for (const tipo of ['saida', 'entrada']) {   // DF: Emitente primeiro, depois Destinatário
    if (!e[`baixar_${tipo}`]) continue;
    const mods = { 55: ['NFE'], 65: ['NFCE'] }[e.modelo] || ['NFE', 'NFCE'];
    const faltam = mods.filter(mod => !ja.some(i => i.empresa_id === e.id && i.tipo === tipo && i.mod === mod && i.comp === comp && !['erro'].includes(i.estado)));
    if (!faltam.length) continue;
    let dl = null;
    try {
      const r = await api({ metodo: 'POST', caminho: 'downloads', prefer: 'return=representation',
        corpo: { empresa_id: e.id, escritorio_id: m.escritorio_id, execucao_id: m.execucao_id || null, competencia: comp, tipo, status: 'fila', mensagem: 'DF: solicitando os XMLs no Agênci@Net' } });
      dl = r[0].id;
    } catch (er) { console.warn('df downloads:', er.message); dl = 'x' + Date.now() + Math.random().toString(36).slice(2, 6); }
    for (const mod of faltam) novos.push({ id: `${dl}:${mod}`, dl, empresa_id: e.id, nome: e.razao_social, codigo: e.codigo || '',
      mae: (e.pasta || rot?.pasta_destino || 'C:\\Notas').replace(/[\\/]+$/, ''), cnpj: soDig(e.cnpj), tipo,
      origem: tipo === 'entrada' ? 'D' : 'E', mod, ini: brData(ini), fim: brData(fim), comp, estado: 'a_solicitar', em: Date.now() });
  }
  await mudarDf(d => { d.itens = d.itens.filter(i => Date.now() - (i.em || 0) < 45 * 24 * 3600e3 || PEND_DF.includes(i.estado)); d.itens.push(...novos); });
  if (soDf && m.execucao_id) api({ metodo: 'PATCH', caminho: `execucoes?id=eq.${m.execucao_id}`, corpo: { status: 'concluida', iniciada_em: new Date().toISOString(), finalizada_em: new Date().toISOString() } }).catch(() => {});
  await abrirDf(true);
}

async function abrirDf(forcar) {
  // 3.13.7: se a aba do DF está no meio de uma volta, não recarrega (ela mesma pega as empresas novas da fila).
  const { dfRodando } = await get('dfRodando');
  if (dfRodando && Date.now() - dfRodando < 12 * 60e3) return;
  // 3.13.1: abrir aba nova perde o login do certificado; reaproveita a aba do Agênci@Net que já está logada.
  const logada = (await chrome.tabs.query({ url: DF_BASE + '/*' })).find(t => !/CertificadoDigital/i.test(t.url || ''));
  // 3.13.6: se a aba já está no DEC, ir para o mesmo endereço não recarrega a página (só muda o #) e o robô não liga; recarrega.
  if (logada) {
    await set({ dfAba: logada.id });
    if (/\/DEC\//i.test(logada.url || '')) await chrome.tabs.reload(logada.id);
    else await chrome.tabs.update(logada.id, { url: DF_DEC });
    return;
  }
  const { dfAba } = await get('dfAba');
  if (dfAba) {
    const t = await chrome.tabs.get(dfAba).catch(() => null);
    if (t && /agencianet\.fazenda\.df\.gov\.br/.test(t.url || t.pendingUrl || '')) {
      if (forcar) { if (/\/DEC\//i.test(t.url || '')) await chrome.tabs.reload(dfAba); else await chrome.tabs.update(dfAba, { url: DF_DEC }); }
      return;
    }
  }
  let t;
  try { t = await chrome.tabs.create({ url: DF_DEC, active: false }); }
  catch (_) { const w = await chrome.windows.create({ url: DF_DEC, focused: false }); t = w.tabs[0]; }
  await set({ dfAba: t.id });
}

async function linhaDf(dl) {
  if (!dl || String(dl).startsWith('x')) return;
  const { df } = await get('df');
  const its = (df?.itens || []).filter(i => i.dl === dl);
  if (!its.length) return;
  const erro = its.find(i => i.estado === 'erro');
  if (erro) return marcarDl(dl, { status: 'erro', mensagem: erro.msg?.slice(0, 400) || 'Erro no DF' }).catch(() => {});
  // 3.13.14: mostra o que aconteceu com cada modelo (ex.: "NF-e: pedido, aguardando o DF · NFC-e: DF sem notas no período").
  const desc = i => `${i.mod === 'NFCE' ? 'NFC-e' : 'NF-e'}: ${({ a_solicitar: 'a pedir', solicitado: 'pedido, aguardando o DF', sem_notas: 'DF sem notas no período', baixado: 'baixado' })[i.estado] || i.estado}`;
  const resumo = `DF ${its.map(desc).join(' · ')}`;
  const pend = its.filter(i => PEND_DF.includes(i.estado));
  if (pend.length) {
    const aviso = pend.find(i => i.msg)?.msg;
    return marcarDl(dl, { status: 'fila', mensagem: `${resumo}.${aviso ? ' ' + aviso : ''}` }).catch(() => {});
  }
  if (its.every(i => i.estado === 'sem_notas')) return marcarDl(dl, { status: 'sem_notas', qtd_notas: 0, mensagem: resumo }).catch(() => {});
  const { zips } = await get('zips');
  if (!Object.keys(zips || {}).some(k => k.startsWith(dl + ':'))) marcarDl(dl, { status: 'concluido', mensagem: its.some(i => i.estado === 'sem_notas') ? resumo : null }).catch(() => {});
}

async function baixarDf(id, hash) {
  const it = await mudarDf(d => d.itens.find(i => i.id === id));
  if (!it) return false;
  // 3.13.4: no DF o download sai horas depois do pedido; pega a pasta/código/nome atuais do cadastro.
  try {
    const [e] = await api({ caminho: `empresas?select=pasta,codigo,razao_social,escritorio_id&id=eq.${it.empresa_id}` });
    const r = e && (await api({ caminho: `rotinas?select=pasta_destino&escritorio_id=eq.${e.escritorio_id}` }).catch(() => []))?.[0];
    if (e) Object.assign(it, { mae: (e.pasta || r?.pasta_destino || it.mae).replace(/[\\/]+$/, ''), codigo: e.codigo || '', nome: e.razao_social || it.nome });
  } catch (_) {}
  const mmaaaa = it.comp.slice(5, 7) + it.comp.slice(0, 4);
  const tipoNome = it.tipo === 'entrada' ? 'Entrada' : 'Saida';
  const nomeArq = `NOTAS\\${mmaaaa}\\${tipoNome}_${it.mod}_${mmaaaa}.zip`;
  const guia = JSON.stringify({ m: it.mae, c: it.codigo, n: it.nome, a: nomeArq });
  const b64 = btoa(unescape(encodeURIComponent(guia))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const limpoN = t => String(t).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  await mudarZips(z => { z[id] = { em: Date.now() }; });
  await marcarDl(id, { status: 'processando', arquivo: `${it.mae}\\${limpoN(it.codigo ? `${it.codigo} - ${it.nome}` : it.nome)}\\${nomeArq}`, mensagem: 'Baixando o ZIP do DF...' }).catch(() => {});
  const url = `${DF_BASE}/DEC/BaixaPacoteConcluidoDEC?HashId=${encodeURIComponent(hash)}`;
  const filename = `Notas Sefaz/_organizar/${it.cnpj}_${it.tipo}${it.mod}_${mmaaaa}__${b64}.zip`;
  nomesDf.set(url, filename); setTimeout(() => nomesDf.delete(url), 10 * 60e3);
  const dId = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  await mudarZips(z => { if (z[id]) z[id].id = dId; });
  await mudarDf(d => { const i = d.itens.find(x => x.id === id); if (i) Object.assign(i, { estado: 'baixado', hash, baixadoEm: Date.now(), msg: null }); });
  return true;
}

// Funções que rodam dentro da página do DEC (precisam do Angular da própria página).
const DF_PAGINA = {
  estado: () => ({ pronto: !!(window.angular && document.querySelector('[ng-model="ctrl.consulta.CpfCnpj"]')),
    // 3.13.12: lê também direto da Cloudflare (o campo escondido às vezes fica vazio com a caixinha verde).
    token: (() => { let t = (document.getElementById('capAgnet') || {}).value || ''; if (!t) try { t = window.turnstile?.getResponse() || ''; } catch (_) {} return t; })() }),
  renovar: () => {
    // Caixinha verde mas sem código novo: manda a Cloudflare gerar outro.
    try { const c = document.getElementById('capAgnet'); if (c) c.value = ''; } catch (_) {}
    try { window.turnstile?.reset('#capcthaAgnet'); } catch (_) {}
    try { window.turnstile?.reset(); } catch (_) {}
    return true;
  },
  resetCaptcha: () => {
    try { const c = document.getElementById('capAgnet'); if (c) c.value = ''; window.turnstile?.reset('#capcthaAgnet'); } catch (_) {}
    return true;
  },
  solicitar: async (it) => {
    const el = document.querySelector('[ng-model="ctrl.consulta.CpfCnpj"]');
    const sc = window.angular.element(el).scope(); const ctrl = sc.ctrl;
    const d = s => { const [a, b, c] = s.split('/').map(Number); return new Date(c, b - 1, a); };
    let res = null;
    const n = ctrl.notificacao, os = n.sucesso, oe = n.erro;
    n.sucesso = function (m) { res = { ok: true, msg: String(m) }; return os.apply(this, arguments); };
    n.erro = function (m) { res = { ok: false, msg: String(m) }; return oe.apply(this, arguments); };
    try {
      sc.$apply(() => Object.assign(ctrl.consulta, { Origem: it.origem, Tipo: it.mod, Criterio: 'D', CpfCnpj: it.cnpj,
        DataInicio: d(it.ini), DataFim: d(it.fim), NumeroInicio: null, NumeroFim: null }));
      sc.$apply(() => ctrl.solicitar());
      for (let i = 0; i < 120 && !res; i++) await new Promise(r => setTimeout(r, 500));
    } finally { n.sucesso = os; n.erro = oe; }
    return res || { ok: false, msg: 'O DF não respondeu em 60 s' };
  },
  pacotes: async () => {
    const inj = window.angular.element(document.querySelector('[ng-app]') || document.body).injector();
    const $r = inj.get('$rootScope'), srv = inj.get('PacotesAgendadosSrv');
    let p; $r.$apply(() => { p = srv.consultarSolicitacoesPacotes(); });
    const r = await p;
    const so = t => String(t ?? '').replace(/\D/g, '');
    const lista = (r.data || []).map(o => {
      const vals = Object.values(o).filter(v => typeof v === 'string' || typeof v === 'number');
      const crit = vals.find(v => typeof v === 'string' && /^\s*(NFC?E|CTE|MDFE)\s*-/i.test(v)) || '';
      const cnpj = so(vals.find(v => /^\d{11,14}$/.test(so(v)) && String(v).replace(/[\d.\/-]/g, '') === ''));
      const situacao = vals.find(v => typeof v === 'string' && /conclu|process|aguard|erro|cancel|solicit/i.test(v) && v !== crit) || '';
      return { hash: o.HashId, concl: o.Condicao === 'C', crit, cnpj, situacao: String(situacao) };
    });
    return { ok: true, lista, bruto: (r.data || []).slice(0, 2) };
  },
  verificar: async (hash) => {
    const inj = window.angular.element(document.querySelector('[ng-app]') || document.body).injector();
    let p; inj.get('$rootScope').$apply(() => { p = inj.get('PacotesAgendadosSrv').verificarArquivoDownload({ HashId: hash }); });
    const r = await p; return { ok: r.data == -1, status: r.data };
  },
  contar: async (hash) => {
    const r = await fetch('/DEC/BaixaPacoteConcluidoDEC?HashId=' + encodeURIComponent(hash), { credentials: 'include' });
    if (!r.ok) return { ok: false };
    const b = new Uint8Array(await r.arrayBuffer()), v = new DataView(b.buffer);
    let i = b.length - 22; while (i >= 0 && v.getUint32(i, true) !== 0x06054b50) i--;
    if (i < 0) return { ok: false };
    let o = v.getUint32(i + 16, true), n = 0;
    const tot = v.getUint16(i + 10, true);
    for (let k = 0; k < tot && v.getUint32(o, true) === 0x02014b50; k++) {
      const ln = v.getUint16(o + 28, true), le = v.getUint16(o + 30, true), lc = v.getUint16(o + 32, true);
      if (/\.xml$/i.test(new TextDecoder().decode(b.subarray(o + 46, o + 46 + ln)))) n++;
      o += 46 + ln + le + lc;
    }
    return { ok: true, n };
  },
  cancelar: async (hash) => {
    const inj = window.angular.element(document.querySelector('[ng-app]') || document.body).injector();
    let p; inj.get('$rootScope').$apply(() => { p = inj.get('PacotesAgendadosSrv').cancelarSolicitacaoPacote({ HashId: hash }); });
    await p; return true;
  },
};

async function mensagemDf(m, remetente) {
  const tab = remetente.tab;
  if (m.tipo === 'dfMinhaAba') { const { dfAba } = await get('dfAba'); return !!tab && tab.id === dfAba; }
  if (m.tipo === 'dfItens') { const { df } = await get('df'); return df?.itens || []; }
  if (m.tipo === 'dfMarcar') {
    const dl = await mudarDf(d => { const i = d.itens.find(x => x.id === m.id); if (i) Object.assign(i, m.patch); return i?.dl; });
    await linhaDf(dl); return true;
  }
  if (m.tipo === 'dfBaixar') return baixarDf(m.id, m.hash);
  if (m.tipo === 'dfQtd') {
    // Soma NF-e + NFC-e da mesma empresa/tipo e grava no download do painel.
    const soma = await mudarDf(d => {
      const i = d.itens.find(x => x.id === m.id); if (!i) return null;
      i.n = m.n;
      return { dl: i.dl, n: d.itens.filter(x => x.dl === i.dl).reduce((t, x) => t + (x.n || 0), 0) };
    });
    if (soma && !String(soma.dl).startsWith('x')) await marcarDl(soma.dl, { qtd_notas: soma.n }).catch(() => {});
    return true;
  }
  if (m.tipo === 'dfDiag') return set({ dfDiag: { em: Date.now(), amostra: m.amostra } });
  if (m.tipo === 'dfPagina') {
    const f = DF_PAGINA[m.acao]; if (!f) throw new Error('ação desconhecida');
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'MAIN', func: f, args: m.arg !== undefined ? [m.arg] : [] });
    return r?.result;
  }
  if (m.tipo === 'dfLogin') {
    marcarVerificacao(true);
    await alertar(tab, 'Sefaz DF: entre com o certificado', 'Na aba do Agênci@Net, entre com o certificado digital do escritório. Depois eu continuo sozinho.');
    return true;
  }
  if (m.tipo === 'dfVerificacao') {
    marcarVerificacao(true);
    await alertar(tab, 'Sefaz DF: confirme que é humano', 'Marque a caixinha da Cloudflare na aba do Agênci@Net. Depois eu continuo sozinho.');
    return true;
  }
  if (m.tipo === 'dfTravou') {
    marcarVerificacao(true);
    await alertar(tab, 'Sefaz DF: a consulta parou', 'Na aba do Agênci@Net, aperte F5 (ou clique em Limpar e marque a caixinha). Depois eu continuo sozinho.');
    return true;
  }
  if (m.tipo === 'dfRodando') { await set({ dfRodando: Date.now() }); return true; }
  if (m.tipo === 'dfOk') { marcarVerificacao(false); await limparAlerta(); return true; }
  if (m.tipo === 'dfFim') {
    await set({ dfRodando: 0 });
    const { df } = await get('df');
    for (const dl of new Set((df?.itens || []).map(i => i.dl))) await linhaDf(dl);
    // Volta terminada: fecha a aba que a extensão abriu (na próxima volta abre de novo).
    // 3.13.1: a aba fica aberta (logada) para a próxima volta.
    return true;
  }
}

// A cada 5 min (3.13.6; antes 30): se há pedido no DF esperando, abre o Agênci@Net em segundo plano para baixar.
// 3.13.9: só cria o alarme se ainda não existe. Recriar a cada vez que a extensão acorda zerava o relógio e ele nunca tocava.
// 3.13.14: conferência a cada 10 min (pedido novo pelo painel continua começando na hora).
chrome.alarms.get('df', a => { if (!a || a.periodInMinutes !== 10) chrome.alarms.create('df', { periodInMinutes: 10 }); });
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== 'df') return;
  const { df } = await get('df');
  if ((df?.itens || []).some(i => PEND_DF.includes(i.estado) || (i.estado === 'baixado' && !i.limpo))) abrirDf(false).catch(() => {});
});
chrome.tabs.onRemoved.addListener(async id => { const { dfAba } = await get('dfAba'); if (dfAba === id) set({ dfAba: null, dfRodando: 0 }); });
