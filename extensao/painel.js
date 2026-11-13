// Roda no site do painel: avisa que a extensão está instalada e repassa o botão "Baixar agora".
document.documentElement.dataset.automacaoNotas = '1';
window.addEventListener('message', e => {
  if (e.source !== window || e.data?.tipo !== 'automacao-notas:executar') return;
  chrome.runtime.sendMessage({ tipo: 'executar', escritorio_id: e.data.escritorio_id, execucao_id: e.data.execucao_id });
});
