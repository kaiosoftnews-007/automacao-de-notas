// Configuração da atualização com um clique.
// SITE: onde o painel publica /data/<EXT>.json e /data/<EXT>.zip
export const SITE = 'https://automacao-de-notas.denise-vaz1541.workers.dev';
export const EXT = 'automacao-notas';

// Arquivos que existem só na pasta do usuário e nunca são tocados pela atualização.
export const NUNCA_SOBRESCREVER = ['credenciais.json'];

// true se a versão a for maior que b (major.minor.patch como números)
export function maior(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function buscarPublicada() {
  const r = await fetch(`${SITE}/data/${EXT}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!/^\d+\.\d+\.\d+$/.test(j.versao || '')) throw new Error('json sem versão');
  return { versao: j.versao, mudancas: Array.isArray(j.mudancas) ? j.mudancas : [] };
}
