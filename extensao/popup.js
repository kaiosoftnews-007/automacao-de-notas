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
      const id = $('esc').value, { credSefaz = {} } = await chrome.storage.local.get('credSefaz');
      let cpf = credSefaz[id]?.cpf || '';
      if (!cpf) try { cpf = (await bg({ tipo: 'api', caminho: `credenciais_sefaz?select=cpf&escritorio_id=eq.${id}` }))[0]?.cpf || ''; } catch (_) {}
      $('cpf').value = cpf; $('ssefaz').value = ''; $('ssefaz').placeholder = credSefaz[id]?.senha ? 'Senha salva ✔ (digite para trocar)' : 'Senha da Sefaz';
    };
    $('esc').addEventListener('change', carregarSefaz); carregarSefaz();
  } catch (e) { $('msg').textContent = e.message; }
}
$('entrar').onclick = async () => {
  $('msg').textContent = '';
  try { await bg({ tipo: 'login', email: $('email').value.trim(), senha: $('senha').value }); mostrar(); }
  catch (e) { $('msg').textContent = e.message; }
};
$('salvarSefaz').onclick = async () => {
  const id = $('esc').value, cpf = $('cpf').value.replace(/\D/g, ''), senha = $('ssefaz').value;
  const { credSefaz = {} } = await chrome.storage.local.get('credSefaz');
  if (cpf.length !== 11) return ($('msg').textContent = 'CPF precisa ter 11 números.');
  if (!senha && !credSefaz[id]?.senha) return ($('msg').textContent = 'Digite a senha da Sefaz.');
  credSefaz[id] = { cpf, senha: senha || credSefaz[id].senha };
  await chrome.storage.local.set({ credSefaz });
  $('ssefaz').value = ''; $('ssefaz').placeholder = 'Senha salva ✔ (digite para trocar)'; $('msg').textContent = '';
};
$('sair').onclick = async () => { await bg({ tipo: 'sair' }); mostrar(); };
mostrar();
