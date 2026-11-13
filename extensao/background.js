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
    if (m.tipo === 'nomeDownload') return set({ proximoNome: { nome: m.nome, ate: Date.now() + 120000 } });
    if (m.tipo === 'executar') return executar(m);
    if (m.tipo === 'salvarPc') return salvarPc(m.nome);
    if (m.tipo === 'lerPc') return (await get('pc')).pc || null;
    if (m.tipo === 'focar') {   // login da Sefaz pediu verificação: avisa sem tirar você da aba em que está
      marcarVerificacao(true);
      await alertar(remetente.tab, 'Sefaz: falta a verificação no login', 'CPF e senha já estão preenchidos. Faça a verificação e clique em Autenticar.');
      return true;
    }
    if (m.tipo === 'irPara') { if (remetente.tab?.id) await chrome.tabs.update(remetente.tab.id, { url: m.url }); return true; }
    if (m.tipo === 'credSefaz') {
      const r = await api({ metodo: 'POST', caminho: 'rpc/extensao_obter_credencial', corpo: { p_escritorio: m.escritorio_id } });
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
    if (m.tipo === 'avisar') return chrome.notifications.create({ type: 'basic', iconUrl: 'icone.png', title: 'Automação de Notas', message: m.texto });
  })().then(ok => responder({ ok }), e => responder({ erro: e.message }));
  return true;
});

// O ZIP do histórico da Sefaz vai para Downloads\Notas Sefaz\<empresa>\<mês>\<Entrada|Saida>\
chrome.downloads.onDeterminingFilename.addListener((item, sugerir) => {
  if (!/sefaz\.go\.gov\.br/.test(item.url + ' ' + (item.referrer || ''))) return;
  get('proximoNome').then(({ proximoNome: p }) => {
    if (p && Date.now() < p.ate) { set({ proximoNome: null }); sugerir({ filename: p.nome, conflictAction: 'uniquify' }); }
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
  await set({ pedido: { escritorio_id: m.escritorio_id, execucao_id: m.execucao_id, ie: m.ie || null, comp: m.comp || null, em: Date.now() } });
  // Abre a Sefaz numa aba em segundo plano: você continua na página em que está.
  if (!m.abriu) {
    try { await chrome.tabs.create({ url: SEFAZ_INICIO, active: false }); }   // abre ao lado, sem tirar você da aba
    catch (_) { await chrome.windows.create({ url: SEFAZ_INICIO, focused: false }); }   // Chrome aberto sem nenhuma janela
  }
  const [esc] = await api({ caminho: `escritorios?select=id,nome&id=eq.${m.escritorio_id}` });
  if (!esc) throw new Error('este login da extensão não enxerga o escritório. Entre na extensão com o mesmo login do painel.');
  await set({ escritorio: esc });
  return true;
}

async function cadastrarPc(nome) {
  const [pc] = await api({ metodo: 'POST', caminho: 'computadores?select=id,nome', prefer: 'return=representation',
    corpo: { nome, versao: chrome.runtime.getManifest().version, ultimo_sinal: new Date().toISOString() } });
  await set({ pc: { id: pc.id, nome: pc.nome } });
  return pc;
}
async function salvarPc(nome) {
  nome = String(nome || '').trim().toUpperCase().slice(0, 40);
  if (!nome) throw new Error('Digite um nome para este computador (ex.: PC-ESCRITORIO).');
  await fixoPronto;
  const { pc } = await get('pc');
  if (pc?.id) {
    const r = await api({ metodo: 'PATCH', caminho: `computadores?id=eq.${pc.id}&select=id`, prefer: 'return=representation', corpo: { nome } });
    if (r?.length) { await set({ pc: { id: pc.id, nome } }); sinal(); return { id: pc.id, nome }; }
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
      corpo: { ultimo_sinal: new Date().toISOString(), versao: chrome.runtime.getManifest().version } });
    if (!r?.length) { await cadastrarPc(pc.nome); return; }   // foi removido no painel: volta para a lista
    if (await ocupado()) return;
    const [p] = await api({ metodo: 'POST', caminho: 'rpc/extensao_pegar_pedido', corpo: { p_pc: pc.id } }) || [];
    if (!p) return;
    await executar({ escritorio_id: p.escritorio_id, execucao_id: p.id, ie: p.ie, comp: p.competencia });
    chrome.notifications.create({ type: 'basic', iconUrl: 'icone.png', title: 'Automação de Notas',
      message: 'Download pedido pelo painel começou neste computador (aba da Sefaz em segundo plano).' });
  } catch (e) { console.warn('sinal:', e.message); }
  finally { sinalRodando = false; }
}

chrome.alarms.create('sinal', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'sinal') sinal(); });
chrome.runtime.onStartup.addListener(() => sinal());
sinal();
