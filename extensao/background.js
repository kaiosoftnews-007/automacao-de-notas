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
    if (m.tipo === 'atualizarAgora') { const r = await conferirAtualizacao(true); if (r?.erro) throw new Error(r.erro); return r?.msg || 'Conferindo…'; }
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
const marcarDl = (dl, corpo) => api({ metodo: 'PATCH', caminho: `downloads?id=eq.${dl}`, corpo: { ...corpo, atualizado_em: new Date().toISOString() } });

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
      if (!item || !item.exists) { await marcarDl(dl, { status: 'concluido', mensagem: null }); delete z[dl]; continue; }   // saiu de _organizar: chegou na pasta
      if (!e.avisado && Date.now() - e.fim > 10 * 60e3) { await marcarDl(dl, { status: 'erro', mensagem: MSG_PARADO }); e.avisado = true; }
      if (Date.now() - e.fim > 7 * 24 * 3600e3) delete z[dl];
    }
  });
}
conferirZips();


// ================= 3.11.0: atualização automática (sem escolher pasta) =================
// A cada minuto (e assim que o Chrome abre) confere web/data/automacao-notas.json. Se há versão nova e nenhum download está
// rodando, baixa o zip para Downloads\Notas Sefaz\_organizar\atualizar-extensao.<id>.<versão>.zip.
// O organizador grava os arquivos na pasta da extensão e deixa atualizacao-status.json lá;
// quando esse arquivo confirma a versão, a extensão se recarrega. Andamento/erro vão para o painel
// (computadores.atualizacao), na tela Atualizações.
const DADOS_ATU = 'https://automacao-de-notas.denise-vaz1541.workers.dev/data/automacao-notas';
const maiorVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function lerProprio(arq) {
  try { const r = await fetch(chrome.runtime.getURL(arq), { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
}
const MSG_ORG = 'Confira se o organizador está rodando e na versão nova (Atualizações → Baixar organizador → INSTALAR-ORGANIZADOR.bat).';

async function conferirAtualizacao(forcar = false) {
  const { atu = {} } = await get('atu');
  const minha = chrome.runtime.getManifest().version;
  if (atu.alvo) {   // já pediu ao organizador: ele gravou?
    const st = await lerProprio('atualizacao-status.json');
    if (st?.versao === atu.alvo && st.ok && maiorVer(atu.alvo, minha)) {
      await set({ atu: { conferido: atu.conferido } }); chrome.runtime.reload(); return { msg: `Atualizando para ${atu.alvo}…` };
    }
    if (st?.versao === atu.alvo && st.ok === false) {
      await set({ atu: { conferido: atu.conferido, erro: `${st.erro || 'falhou'}`, erroVersao: atu.alvo, em: Date.now() } });
      return { erro: `O organizador não conseguiu atualizar: ${st.erro}` };
    }
    if (Date.now() - atu.desde < 10 * 60e3) return { msg: `Atualizando para ${atu.alvo}… (aguardando o organizador)` };
    await set({ atu: { conferido: atu.conferido, erro: `o organizador não aplicou a ${atu.alvo} em 10 minutos. ${MSG_ORG}`, erroVersao: atu.alvo, em: Date.now() } });
    if (!forcar) return;
  }
  if (!forcar && Date.now() - (atu.conferido || 0) < 50e3) return;
  const r = await fetch(`${DADOS_ATU}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`não consegui consultar a versão publicada (HTTP ${r.status})`);
  const { versao } = await r.json();
  const agora = (await get('atu')).atu || {};
  await set({ atu: { ...agora, conferido: Date.now() } });
  if (!/^\d+\.\d+\.\d+$/.test(versao || '') || !maiorVer(versao, minha)) {
    if (agora.erro) await set({ atu: { conferido: Date.now() } });
    return { msg: `Este computador já está na versão mais nova (${minha}).` };
  }
  // depois de um erro, só tenta a mesma versão de novo sozinho depois de 6 h (no botão, na hora)
  if (!forcar && agora.erro && agora.erroVersao === versao && Date.now() - agora.em < 6 * 3600e3) return;
  if (await ocupado()) return { erro: 'Há um download de notas rodando neste computador. A atualização acontece sozinha quando ele terminar.' };
  await chrome.downloads.download({ url: `${DADOS_ATU}.zip?v=${versao}`, conflictAction: 'overwrite', saveAs: false,
    filename: `Notas Sefaz/_organizar/atualizar-extensao.${chrome.runtime.id}.${versao}.zip` });
  await set({ atu: { conferido: Date.now(), alvo: versao, desde: Date.now() } });
  for (const seg of [8, 15, 25, 40]) setTimeout(() => conferirAtualizacao().catch(() => {}), seg * 1000);   // o organizador olha a pasta a cada 5 s
  return { msg: `Baixando a ${versao}. O organizador grava e a extensão se recarrega sozinha em alguns segundos.` };
}
// Texto que vai para o painel (coluna Atualização em Atualizações)
async function textoAtualizacao() {
  const { atu = {} } = await get('atu');
  if (atu.alvo) return `Atualizando para ${atu.alvo}…`;
  if (atu.erro) return `Erro ao atualizar: ${atu.erro}`;
  return null;
}
chrome.alarms.create('atualizacao', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'atualizacao') conferirAtualizacao().catch(e => console.warn('atualização:', e.message)); });
chrome.runtime.onStartup.addListener(() => conferirAtualizacao().catch(() => {}));   // assim que o computador liga e o Chrome abre
