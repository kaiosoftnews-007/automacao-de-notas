const $ = id => document.getElementById(id);
const bg = m => new Promise((ok, err) => chrome.runtime.sendMessage(m, r => r?.erro ? err(new Error(r.erro)) : ok(r?.ok)));

async function mostrar() {
  const { sessao, escritorio } = await chrome.storage.local.get(['sessao', 'escritorio']);
  $('fora').hidden = !!sessao; $('dentro').hidden = !sessao;
  if (!sessao) return;
  $('quem').textContent = sessao.email;
  try {
    const lista = await bg({ tipo: 'api', caminho: 'escritorios?select=id,nome&ativo=eq.true&order=nome' });
    $('esc').innerHTML = lista.map(e => `<option value="${e.id}">${e.nome}</option>`).join('');
    const atual = lista.find(e => e.id === escritorio?.id) || lista[0];
    if (atual) { $('esc').value = atual.id; await chrome.storage.local.set({ escritorio: atual }); }
    $('esc').onchange = () => chrome.storage.local.set({ escritorio: lista.find(e => e.id === $('esc').value) });
    $('msg').textContent = lista.length ? '' : 'Nenhum escritório cadastrado no painel.';
  } catch (e) { $('msg').textContent = e.message; }
}
$('entrar').onclick = async () => {
  $('msg').textContent = '';
  try { await bg({ tipo: 'login', email: $('email').value.trim(), senha: $('senha').value }); mostrar(); }
  catch (e) { $('msg').textContent = e.message; }
};
$('sair').onclick = async () => { await bg({ tipo: 'sair' }); mostrar(); };
mostrar();
