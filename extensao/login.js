// Faz o login na Sefaz sozinho quando há um download em andamento (botão "Baixar" do painel).
// Usa o CPF e a senha da Sefaz guardados só neste Chrome (ícone da extensão).
// Nunca mexe na verificação "Confirme que é humano".
(async () => {
  const CONSULTA = 'https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfe/consulta-notas-recebidas';
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const get = k => chrome.storage.local.get(k);
  const set = o => chrome.storage.local.set(o);
  const visivel = e => !!(e && (e.offsetParent || e.getClientRects().length));
  const avisar = texto => chrome.runtime.sendMessage({ tipo: 'avisar', texto }, () => chrome.runtime.lastError);

  function faixa(msg) {
    let f = document.getElementById('an-faixa');
    if (!f) { f = document.createElement('div'); f.id = 'an-faixa'; document.body.appendChild(f); }
    f.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1F3864;color:#fff;font:14px Arial;padding:10px 14px;text-align:center';
    f.textContent = 'Automação de Notas: ' + msg;
  }

  async function ativo() {
    const { pedido, exec } = await get(['pedido', 'exec']);
    if (pedido && Date.now() - pedido.em < 60 * 60e3) return pedido.escritorio_id;
    if (exec?.rodando) return exec.escritorio.id;
    return null;
  }

  const setar = (e, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, v);
    ['input', 'change', 'blur'].forEach(t => e.dispatchEvent(new Event(t, { bubbles: true })));
  };

  await dorme(1500);
  const esc = await ativo();
  if (!esc) return;
  if (/consulta-notas-recebidas/.test(location.href) && document.querySelector('#cmpNumIeDest')) return; // tela certa: o content.js cuida

  const senha = [...document.querySelectorAll('input[type=password]')].find(visivel);
  if (senha) {
    const { credSefaz = {}, login = {} } = await get(['credSefaz', 'login']);
    const c = credSefaz[esc];
    if (!c?.senha) {
      faixa('falta a senha da Sefaz. Clique no ícone da extensão e salve o CPF e a senha do contador.');
      return avisar('Falta a senha da Sefaz: clique no ícone da extensão e salve.');
    }
    const recente = Date.now() - (login.em || 0) < 120e3;
    if (recente && login.n >= 2) {
      faixa('a Sefaz não aceitou a senha salva. Confira o CPF e a senha no ícone da extensão.');
      await set({ pedido: null });
      return avisar('A Sefaz recusou a senha salva na extensão.');
    }
    await set({ login: { em: Date.now(), n: recente ? (login.n || 0) + 1 : 1 } });
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

  // Logado, mas fora da tela de consulta: vai para ela (com limite para não ficar em círculo).
  if (window.top !== window) return;
  const { idas = {} } = await get('idas');
  const n = Date.now() - (idas.em || 0) < 120e3 ? (idas.n || 0) + 1 : 1;
  await set({ idas: { em: Date.now(), n } });
  if (n > 4) return faixa('não consegui chegar na tela "Baixar XML NFE". Abra ela pelo menu que eu continuo.');
  faixa('abrindo a tela Baixar XML NFE...');
  location.href = CONSULTA;
})();
