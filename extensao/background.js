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
  if (Date.now() > sessao.expira) sessao = await auth({ refresh_token: sessao.refresh }, 'refresh_token');
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
    if (m.tipo === 'sair') return set({ sessao: null });
    if (m.tipo === 'api') return api(m);
    if (m.tipo === 'nomeDownload') return set({ proximoNome: { nome: m.nome, ate: Date.now() + 120000 } });
    if (m.tipo === 'executar') {
      await set({ pedido: { escritorio_id: m.escritorio_id, execucao_id: m.execucao_id, ie: m.ie || null, em: Date.now() } });
      if (!m.abriu) await chrome.tabs.create({ url: 'https://portal.sefaz.go.gov.br/portalsefaz-apps/' });
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
