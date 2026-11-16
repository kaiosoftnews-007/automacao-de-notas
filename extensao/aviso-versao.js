// Aviso de versão nova no popup + botão que abre a página de atualização.
// Usa <div id="aviso-versao"> e <button id="abrir-atualizar"> do popup.html.
import { maior, buscarPublicada } from './atualizacao-config.js';

const versaoAtual = document.getElementById('versao-atual');
if (versaoAtual) versaoAtual.textContent = `Versão ${chrome.runtime.getManifest().version}`;

const botao = document.getElementById('abrir-atualizar');
if (botao) {
  botao.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('atualizar.html') });
  });
}

(async () => {
  const caixa = document.getElementById('aviso-versao');
  if (!caixa) return;
  try {
    const { versao, mudancas } = await buscarPublicada();
    const minha = chrome.runtime.getManifest().version;
    if (!maior(versao, minha)) return;

    caixa.textContent = '';
    caixa.style.cssText = 'background:#FFF4E5;border:1px solid #E8A33D;color:#5C3600;' +
      'border-radius:8px;padding:8px 10px;margin:8px 0;font-size:12px;line-height:1.4';

    const t = document.createElement('div');
    t.style.fontWeight = '600';
    t.textContent = `Há uma versão nova (${versao}; a sua é ${minha}). Clique em Atualizar a extensão.`;
    caixa.appendChild(t);

    if (mudancas.length) {
      const titulo = document.createElement('div');
      titulo.style.marginTop = '6px';
      titulo.textContent = 'O que mudou:';
      const ul = document.createElement('ul');
      ul.style.cssText = 'margin:2px 0 0;padding-left:18px';
      for (const item of mudancas.slice(0, 8)) {
        const li = document.createElement('li');
        li.textContent = String(item).slice(0, 200);
        ul.appendChild(li);
      }
      caixa.append(titulo, ul);
    }
    caixa.hidden = false;
  } catch { /* sem rede: sem aviso */ }
})();
