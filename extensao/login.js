// Leva a aba até a tela "Baixar XML NFE" sozinha quando há um download pedido pelo painel:
// login no portal → Acesso Restrito → menu "Baixar XML NFE" → senha de novo, se pedir.
// A tela de consulta não abre por link direto (a Sefaz responde "sem permissão").
// Usa o CPF e a senha da Sefaz guardados só neste Chrome. Nunca mexe na verificação "Confirme que é humano".
(async () => {
  const ACESSO = 'https://www.sefaz.go.gov.br/netaccess/000System/acessoRestrito/';
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const get = k => chrome.storage.local.get(k);
  const set = o => chrome.storage.local.set(o);
  const visivel = e => !!(e && (e.offsetParent || e.getClientRects().length));
  const msg = m => new Promise(r => chrome.runtime.sendMessage(m, x => { chrome.runtime.lastError; r(x); }));
  const avisar = texto => msg({ tipo: 'avisar', texto });
  const texto = () => document.body?.innerText || '';
  const topo = window.top === window;

  function faixa(m) {
    if (!topo) return;
    let f = document.getElementById('an-faixa');
    if (!f) { f = document.createElement('div'); f.id = 'an-faixa'; document.body.appendChild(f); }
    f.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1F3864;color:#fff;font:14px Arial;padding:10px 14px;text-align:center';
    f.textContent = 'Automação de Notas: ' + m;
  }

  // Pedido do painel que veio no endereço da aba (#automacao=...)
  try {
    const mh = location.hash.match(/automacao=([^&]+)/);
    if (mh) {
      const p = JSON.parse(decodeURIComponent(mh[1]));
      await set({ pedido: { ...p, em: Date.now() }, login: {}, idas: {}, cliques: {} });
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (_) {}

  async function ativo() {
    const { pedido, exec } = await get(['pedido', 'exec']);
    if (pedido && Date.now() - pedido.em < 60 * 60e3) return pedido.escritorio_id;
    if (exec?.rodando) return exec.escritorio.id;
    return null;
  }

  // Limite para não ficar andando em círculo.
  async function conta(chave, max) {
    const o = (await get(chave))[chave] || {};
    const n = Date.now() - (o.em || 0) < 3 * 60e3 ? (o.n || 0) + 1 : 1;
    await set({ [chave]: { em: Date.now(), n } });
    return n <= max;
  }

  const setar = (e, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, v);
    ['input', 'change', 'blur'].forEach(t => e.dispatchEvent(new Event(t, { bubbles: true })));
  };

  async function irPara(url, aviso) {
    if (!(await conta('idas', 5))) {
      faixa('não consegui chegar na tela "Baixar XML NFE". Abra ela pelo menu que eu continuo.');
      return avisar('Não consegui abrir a tela Baixar XML NFE sozinho. Abra pelo menu que eu continuo.');
    }
    faixa(aviso);
    await msg({ tipo: 'irPara', url });       // o background troca o endereço da aba (funciona até de dentro de quadros)
  }

  await dorme(800);
  const esc = await ativo();
  if (!esc) return;
  if (document.querySelector('#cmpNumIeDest') || document.querySelector('#btnHistoricoDownload')) return; // tela certa: o content.js cuida

  // 1) Tela pedindo senha (login do portal ou "requer nova autenticação")
  const senha = [...document.querySelectorAll('input[type=password]')].find(visivel);
  if (senha) {
    const { credSefaz = {} } = await get('credSefaz');
    const c = credSefaz[esc];
    if (!c?.senha) {
      faixa('falta a senha da Sefaz. Clique no ícone da extensão e salve o CPF e a senha do contador.');
      return avisar('Falta a senha da Sefaz: clique no ícone da extensão e salve.');
    }
    if (!(await conta('login', 2))) {
      faixa('a Sefaz não aceitou a senha salva. Confira o CPF e a senha no ícone da extensão.');
      await set({ pedido: null });
      return avisar('A Sefaz recusou a senha salva na extensão.');
    }
    faixa('entrando na Sefaz...');
    const campos = [...document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio])')].filter(visivel);
    const cpf = campos.find(e => /cpf/i.test(e.placeholder + e.name + e.id)) || campos[0];
    if (cpf && !cpf.readOnly && cpf.value.replace(/\D/g, '') !== c.cpf) setar(cpf, c.cpf);
    setar(senha, c.senha);
    await dorme(400);
    const botao = [...document.querySelectorAll('button,input[type=submit],input[type=button],a')]
      .find(b => visivel(b) && /autenticar|entrar/i.test(b.innerText || b.value || ''));
    if (botao) botao.click(); else senha.form?.requestSubmit?.() || senha.form?.submit();
    return;
  }

  // 2) "Você não tem permissão" (link direto da consulta) → recomeça pelo Acesso Restrito
  if (/n[ãa]o tem permiss[ãa]o/i.test(texto())) return irPara(ACESSO, 'abrindo o Acesso Restrito...');

  // 3) Acesso Restrito (menu ou quadro interno): clica em "Baixar XML NFE"
  if (location.host === 'www.sefaz.go.gov.br' && /netaccess/i.test(location.pathname)) {
    await dorme(1200);
    const alvo = [...document.querySelectorAll('a,li,span,div,td')]
      .filter(e => visivel(e) && /^[:\s]*Baixar XML NFE\s*$/i.test(e.innerText || ''))
      .sort((a, b) => (a.tagName === 'A' ? -1 : 0) - (b.tagName === 'A' ? -1 : 0) || a.innerText.length - b.innerText.length)[0];
    if (!alvo) return;                                   // outro quadro deste site cuida
    if (topo) {                                          // prefere o link do quadro interno; o menu é o reserva
      await dorme(2500);
      const { cliques } = await get('cliques');
      if (cliques && Date.now() - cliques.em < 6000) return;
    }
    if (!(await conta('cliques', 4))) return faixa('não consegui abrir "Baixar XML NFE". Clique no menu que eu continuo.');
    faixa('abrindo Baixar XML NFE...');
    (alvo.querySelector('a') || alvo).click();
    return;
  }

  // 4) Portal (logado, sem senha na tela) → Acesso Restrito
  if (location.host === 'portal.sefaz.go.gov.br' && topo) return irPara(ACESSO, 'abrindo o Acesso Restrito...');
})();
