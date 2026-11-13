// Leva a aba até a tela "Baixar XML NFE" sozinha quando há um download pedido pelo painel:
// login no portal → Acesso Restrito → menu "Baixar XML NFE" → senha de novo, se pedir.
// A tela de consulta não abre por link direto (a Sefaz responde "sem permissão").
// Usa o CPF e a senha da Sefaz guardados só neste Chrome. Nunca mexe na verificação "Confirme que é humano".
(async () => {
  const PORTAL = 'https://portal.sefaz.go.gov.br/portalsefaz-apps/';
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

  // Clica pelo próprio site: os menus da Sefaz usam links "javascript:", que o Chrome bloqueia se o clique vier da extensão.
  const clicar = async (el, modo = '1') => { document.querySelectorAll('[data-an-clicar]').forEach(x => x.removeAttribute('data-an-clicar'));
    el.setAttribute('data-an-clicar', modo); await msg({ tipo: 'clicar' }); };

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
    const r = await msg({ tipo: 'credSefaz', escritorio_id: esc });
    let c = r?.ok;
    if (!c?.senha) c = ((await get('credSefaz')).credSefaz || {})[esc];   // reserva: senha salva no ícone da extensão
    if (!c?.senha) {
      faixa('não achei o login da Sefaz deste escritório. Cadastre em "Acesso à Sefaz" no painel.');
      return avisar('Login da Sefaz não encontrado: cadastre em Acesso à Sefaz no painel.' + (r?.erro ? ' (' + r.erro + ')' : ''));
    }
    if (!(await conta('login', 5))) {
      faixa('a Sefaz não aceitou o CPF e a senha. Confira em "Acesso à Sefaz" no painel.');
      await set({ pedido: null });
      return avisar('A Sefaz recusou o login cadastrado no painel (Acesso à Sefaz).');
    }
    // Digita como uma pessoa: o campo de CPF tem máscara e o preenchimento automático do Chrome
    // não conta para o site (dá "informe um CPF válido"). Por isso sempre apaga e digita de novo.
    const digitar = async (el, txt) => {
      const setV = v => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.focus(); el.click?.();
      setV(''); el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      for (const ch of txt) {
        const k = { key: ch, bubbles: true };
        el.dispatchEvent(new KeyboardEvent('keydown', k)); el.dispatchEvent(new KeyboardEvent('keypress', k));
        setV(el.value + ch);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
        el.dispatchEvent(new KeyboardEvent('keyup', k));
        await dorme(35);
      }
      el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true }));
    };
    const recusou = () => /(senha|credenciais?)[^.\n]{0,40}(inv[aá]lid|incorret|n[aã]o confere)|bloquead/i.test(texto());
    for (let tentativa = 1; tentativa <= 4; tentativa++) {
      faixa(tentativa === 1 ? 'entrando na Sefaz...' : `entrando na Sefaz (tentativa ${tentativa})...`);
      const campos = [...document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio])')].filter(visivel);
      const cpf = campos.find(e => /cpf/i.test(e.placeholder + e.name + e.id)) || campos[0];
      const sen = [...document.querySelectorAll('input[type=password]')].find(visivel);
      if (!sen) return;                                          // saiu da tela de login: deu certo
      const ok = (await msg({ tipo: 'preencherLogin', cpf: c.cpf, senha: c.senha }))?.ok;
      if (!ok?.cpfOk || !ok?.senhaOk) {                          // reserva: digita tecla por tecla
        if (cpf && !cpf.readOnly && !cpf.disabled) await digitar(cpf, c.cpf);
        await digitar(sen, c.senha);
      }
      await dorme(600);
      const botao = [...document.querySelectorAll('button,input[type=submit],input[type=button],a')]
        .find(b => visivel(b) && /autenticar|entrar/i.test(b.innerText || b.value || ''));
      if (botao) await clicar(botao); else sen.form?.requestSubmit?.() || sen.form?.submit();
      await dorme(5000);
      if (![...document.querySelectorAll('input[type=password]')].some(visivel)) return;   // entrou
      if (recusou()) break;                                      // senha errada de verdade: não insiste
    }
    if (recusou()) {
      faixa('a Sefaz não aceitou o CPF e a senha. Confira em "Acesso à Sefaz" no painel.');
      await set({ pedido: null });
      return avisar('A Sefaz recusou o login cadastrado no painel (Acesso à Sefaz).');
    }
    faixa('não consegui entrar depois de 4 tentativas. Recarregue a página (F5) que eu tento de novo.');
    return;
  }

  // 2) "Você não tem permissão" (link direto da consulta) → recomeça pelo Acesso Restrito
  if (/n[ãa]o tem permiss[ãa]o/i.test(texto())) return irPara(PORTAL, 'voltando ao portal da Sefaz...');

  // 3) Acesso Restrito (menu ou quadro interno): clica em "Baixar XML NFE"
  if (location.host === 'www.sefaz.go.gov.br' && /netaccess/i.test(location.pathname)) {
    await dorme(1200);
    // Tela em branco do Acesso Restrito (aberto sem passar pelo portal): volta ao portal e entra pelo card.
    if (topo && /loginPortal/i.test(location.pathname)) {
      await dorme(4000);
      if (/loginPortal/i.test(location.pathname) && !texto().trim()) return irPara(PORTAL, 'entrando pelo portal da Sefaz...');
      return;
    }
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
    await clicar(alvo.querySelector('a') || alvo);
    return;
  }

  // 4) Portal (logado, sem senha na tela) → clica no card "Acesso Restrito" (abre a tela com o login já passado)
  if (location.host === 'portal.sefaz.go.gov.br' && topo) {
    let card = null;
    for (let i = 0; i < 10 && !card; i++) {
      card = [...document.querySelectorAll('a,div,span,h1,h2,h3,h4,h5,p')]
        .filter(e => visivel(e) && /^\s*Acesso Restrito\s*$/i.test(e.innerText || ''))
        .sort((a, b) => a.innerText.length - b.innerText.length)[0];
      if (!card) await dorme(800);
    }
    if (!card) return irPara(PORTAL, 'abrindo o portal da Sefaz...');
    if (!(await conta('cliques', 4))) return faixa('não consegui abrir o Acesso Restrito. Clique no card que eu continuo.');
    faixa('abrindo o Acesso Restrito...');
    await clicar(card.closest('a') || card, 'card');
  }
})();
