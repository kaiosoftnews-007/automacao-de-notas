// Roda no site do painel: avisa que a extensão está instalada e repassa o botão "Baixar".
document.documentElement.dataset.automacaoNotas = '1';
window.addEventListener('message', e => {
  if (e.source !== window || e.data?.tipo !== 'automacao-notas:executar') return;
  const erro = msg => window.postMessage({ tipo: 'automacao-notas:erro', msg }, location.origin);
  try {
    chrome.runtime.sendMessage({ tipo: 'executar', escritorio_id: e.data.escritorio_id, execucao_id: e.data.execucao_id,
      ie: e.data.ie || null, abriu: !!e.data.abriu }, r => {
      const m = chrome.runtime.lastError?.message || r?.erro;
      if (m) erro(m);
    });
  } catch (_) {
    erro('a extensão foi atualizada. Aperte Ctrl+F5 nesta página e clique de novo.');
  }
});
