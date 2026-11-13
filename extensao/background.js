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

async function token() {
  let { sessao } = await get('sessao');
  if (!sessao) throw new Error('Entre com o login do painel (ícone da extensão).');
  if (Date.now() > sessao.expira) {
    // O login que veio do painel não é renovado aqui (renovar derrubaria o login do próprio painel).
    if (sessao.doPainel) throw new Error('o login do painel expirou: abra o painel neste Chrome e aperte F5.');
    sessao = await auth({ refresh_token: sessao.refresh }, 'refresh_token');
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
    if (m.tipo === 'login') return auth({ email: m.email, password: m.senha }, 'password').then(s => ({ email: s.email }));
    if (m.tipo === 'sessaoDoPainel') {
      const { sessao } = await get('sessao');
      if (!sessao || sessao.email !== m.email || sessao.expira < m.expira)
        await set({ sessao: { access: m.access, refresh: m.refresh, expira: m.expira, email: m.email, doPainel: true } });
      return true;
    }
    if (m.tipo === 'sair') return set({ sessao: null });
    if (m.tipo === 'api') return api(m);
    if (m.tipo === 'nomeDownload') return set({ proximoNome: { nome: m.nome, ate: Date.now() + 120000 } });
    if (m.tipo === 'executar') {
      await set({ pedido: { escritorio_id: m.escritorio_id, execucao_id: m.execucao_id, ie: m.ie || null, comp: m.comp || null, em: Date.now() } });
      // Abre a Sefaz numa aba em segundo plano: você continua na página em que está.
      if (!m.abriu) await chrome.tabs.create({ url: 'https://portal.sefaz.go.gov.br/portalsefaz-apps/', active: false, index: 999 });
      const [esc] = await api({ caminho: `escritorios?select=id,nome&id=eq.${m.escritorio_id}` });
      if (!esc) throw new Error('este login da extensão não enxerga o escritório. Entre na extensão com o mesmo login do painel.');
      await set({ escritorio: esc });
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
            else u.value = cpf;
            ev(u);
          }
          if (p) { p.focus(); p.value = senha; ev(p); }
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
      await set({ abaVerificacao: { tab: remetente.tab.id, janela: remetente.tab.windowId } });
      chrome.action.setBadgeText({ text: '!' }); chrome.action.setBadgeBackgroundColor({ color: '#B3261E' });
      chrome.notifications.create('verificacao', { type: 'basic', iconUrl: 'icone.png', requireInteraction: true, priority: 2,
        title: 'Sefaz: confirme que é humano', message: 'Clique aqui para abrir a aba da Sefaz e marcar a caixinha. Depois eu continuo sozinho.' });
      return true;
    }
    if (m.tipo === 'verificacaoOk') {
      chrome.action.setBadgeText({ text: '' }); chrome.notifications.clear('verificacao');
      return true;
    }
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

// Clicar no aviso da verificação leva direto para a aba da Sefaz.
chrome.notifications.onClicked.addListener(async id => {
  if (id !== 'verificacao') return;
  const { abaVerificacao: a } = await get('abaVerificacao');
  if (a) { chrome.windows.update(a.janela, { focused: true }); chrome.tabs.update(a.tab, { active: true }); }
  chrome.notifications.clear(id);
});
