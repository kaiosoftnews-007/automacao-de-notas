// Popup: versão instalada + botão que abre a página de atualização.
// O aviso de versão nova fica no painel, em Atualizações.
const el = document.getElementById('versao-atual');
if (el) el.textContent = `Versão ${chrome.runtime.getManifest().version}`;
document.getElementById('abrir-atualizar')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('atualizar.html') });
});
