// Roda no site do painel: avisa que a extensão está instalada, passa o login do painel para a
// extensão (assim ninguém precisa entrar de novo nela) e repassa o botão "Baixar".
document.documentElement.dataset.automacaoNotas = chrome.runtime.getManifest().version;   // versão, para diagnóstico

function enviarSessao() {
  try {
    const chave = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
    if (!chave) return;
    const s = JSON.parse(localStorage.getItem(chave));
    const sessao = s?.currentSession || s;
    if (!sessao?.access_token || !sessao?.refresh_token) return;
    chrome.runtime.sendMessage({ tipo: 'sessaoDoPainel', access: sessao.access_token, refresh: sessao.refresh_token,
      expira: (sessao.expires_at ? sessao.expires_at * 1000 : Date.now() + 3000e3) - 60e3, email: sessao.user?.email }, () => chrome.runtime.lastError);
  } catch (_) {}
}
enviarSessao();
setTimeout(enviarSessao, 3000);   // o site pode ainda estar entrando

window.addEventListener('message', e => {
  if (e.source !== window || e.data?.tipo !== 'automacao-notas:executar') return;
  const erro = msg => window.postMessage({ tipo: 'automacao-notas:erro', msg }, location.origin);
  try {
    enviarSessao();
    chrome.runtime.sendMessage({ tipo: 'executar', escritorio_id: e.data.escritorio_id, execucao_id: e.data.execucao_id,
      ie: e.data.ie || null, abriu: !!e.data.abriu }, r => {
      const m = chrome.runtime.lastError?.message || r?.erro;
      if (m) erro(m);
    });
  } catch (_) {
    erro('a extensão foi atualizada. Aperte Ctrl+F5 nesta página e clique de novo.');
  }
});
