// Popup: mostra a versão instalada e, se houver, o andamento da atualização automática.
// O aviso de versão nova fica no painel, em Atualizações.
(async () => {
  const el = document.getElementById('versao-atual');
  if (!el) return;
  const { atu = {} } = await chrome.storage.local.get('atu');
  let txt = `Versão ${chrome.runtime.getManifest().version}`;
  if (atu.alvo) txt += ` · atualizando para ${atu.alvo}…`;
  else if (atu.erro) txt += ' · a atualização automática falhou (veja em Atualizações, no painel)';
  el.textContent = txt;
})();
