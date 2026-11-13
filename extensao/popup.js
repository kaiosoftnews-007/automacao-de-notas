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
    const carregarSefaz = async () => {
      try {
        const c = await bg({ tipo: 'credSefaz', escritorio_id: $('esc').value });
        $('sefaz').innerHTML = c?.senha ? `Login da Sefaz: CPF ${c.cpf} ✔ (vem do painel)` : '<b style="color:#B3261E">Cadastre o login da Sefaz em "Acesso à Sefaz" no painel.</b>';
      } catch (er) { $('sefaz').textContent = 'Não consegui ler o login da Sefaz: ' + er.message; }
    };
    $('esc').addEventListener('change', carregarSefaz); carregarSefaz();
  } catch (e) { $('msg').textContent = e.message; }
}
$('entrar').onclick = async () => {
  $('msg').textContent = '';
  try { await bg({ tipo: 'login', email: $('email').value.trim(), senha: $('senha').value }); mostrar(); }
  catch (e) { $('msg').textContent = e.message; }
};
$('sair').onclick = async () => { await bg({ tipo: 'sair' }); mostrar(); };
mostrar();
