import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=202611121347';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const root = document.getElementById('root');

// ---------- constantes ----------
const OBRIG = [
  ['impt_nfs', 'Impt. NFs'], ['apuracao', 'Apuração'], ['pgdas', 'PGDAS'],
  ['efd_icms_ipi', 'EFD ICMS IPI'], ['efd_contrib', 'EFD Contrib.'], ['mit', 'MIT'], ['efd_reinf', 'EFD Reinf'],
];
const REGIMES = { simples: 'Simples', presumido: 'Presumido', real: 'Real', mei: 'MEI', outro: 'Outro' };
const ST_ENT = { ok: ['ok', 'OK'], pendente: ['pe', 'Pend.'], atrasado: ['er', 'Atraso'], na: ['na', '—'] };
const CICLO = { pendente: 'ok', ok: 'na', na: 'atrasado', atrasado: 'pendente' };
const ST_DL = {
  fila: ['pe', 'Na fila'], processando: ['pe', 'Baixando'], concluido: ['ok', 'OK'],
  sem_notas: ['pe', 'Sem notas'], erro: ['er', 'Erro'],
};
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#142744" stroke-width="2" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6"/><path d="M9 15l3 3 3-3"/></svg>';

// ---------- estado ----------
const st = { session: null, perfil: null, comp: compPadrao() };

function compPadrao() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return iso(d); }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
function compNome(c) { const [y, m] = c.split('-'); return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][+m - 1]}/${y}`; }
function compOpcoes() {
  const out = []; const d = new Date(); d.setDate(1);
  for (let i = 0; i < 13; i++) { out.push(iso(d)); d.setMonth(d.getMonth() - 1); }
  return out.map(c => `<option value="${c}" ${c === st.comp ? 'selected' : ''}>${compNome(c)}</option>`).join('');
}

// ---------- utilidades ----------
const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => root.querySelector(s);
const $$ = s => [...root.querySelectorAll(s)];
const n = v => Number(v || 0).toLocaleString('pt-BR');
const quando = t => {
  if (!t) return '—';
  const d = new Date(t), hoje = new Date();
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoje.toDateString()) return `hoje, ${hm}`;
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return `ontem, ${hm}`;
  return d.toLocaleDateString('pt-BR') + ' ' + hm;
};
const mascCpf = c => { const d = String(c || '').replace(/\D/g, ''); return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : h(c); };
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) { console.error(error); toast('Erro: ' + error.message); throw error; }
  return data;
}
const eAdmin = () => st.perfil?.papel === 'admin';

// Janela para editar os dados do escritório. Devolve true se salvou.
function editarEscritorio(es) {
  return new Promise(resolve => {
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `<form class="card modal" role="dialog" aria-modal="true" aria-labelledby="et">
      <h2 id="et" style="font-size:18px">Editar escritório</h2>
      <label class="f">Nome<input name="nome" required value="${h(es.nome)}"></label>
      <label class="f">CNPJ<input name="cnpj" value="${h(es.cnpj)}"></label>
      <label class="f">E-mail de contato<input name="email_contato" type="email" value="${h(es.email_contato)}"></label>
      <div class="sub">O login da Sefaz desse escritório fica em <a href="#/acesso?esc=${es.id}">Acesso à Sefaz</a>.</div>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="ecanc">Cancelar</button><button type="submit" class="btn p">Salvar</button></div>
    </form>`;
    document.body.appendChild(fundo);
    const form = fundo.querySelector('form'); form.nome.focus();
    const fechar = ok => { fundo.remove(); resolve(ok); };
    fundo.querySelector('#ecanc').onclick = () => fechar(false);
    fundo.querySelector('a').onclick = () => fechar(false);
    fundo.onclick = e => { if (e.target === fundo) fechar(false); };
    form.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(form);
      await q(sb.from('escritorios').update({ nome: fd.get('nome').trim(), cnpj: fd.get('cnpj') || null, email_contato: fd.get('email_contato') || null }).eq('id', es.id));
      toast('Escritório atualizado.'); fechar(true);
    };
  });
}

// Pede a senha de quem está logado antes de uma exclusão. Devolve true só se a senha estiver certa.
function confirmarComSenha(titulo, texto) {
  return new Promise(resolve => {
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `<form class="card modal" role="dialog" aria-modal="true" aria-labelledby="mt">
      <h2 id="mt" style="font-size:18px">${h(titulo)}</h2>
      <div class="msg err">${h(texto)}</div>
      <label class="f">Digite sua senha para confirmar<input type="password" name="senha" required autocomplete="current-password"></label>
      <div class="sub" id="merr" style="color:#9B1C12"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="mcanc">Cancelar</button><button type="submit" class="btn del">Excluir</button></div>
    </form>`;
    document.body.appendChild(fundo);
    const form = fundo.querySelector('form'), inp = form.senha;
    inp.focus();
    const fechar = ok => { fundo.remove(); resolve(ok); };
    fundo.querySelector('#mcanc').onclick = () => fechar(false);
    fundo.onclick = e => { if (e.target === fundo) fechar(false); };
    form.onsubmit = async e => {
      e.preventDefault();
      const bt = form.querySelector('.del'); bt.disabled = true; bt.textContent = 'Conferindo…';
      st.reautenticando = true;
      const { error } = await sb.auth.signInWithPassword({ email: st.session.user.email, password: inp.value });
      setTimeout(() => { st.reautenticando = false; }, 500);
      if (error) { bt.disabled = false; bt.textContent = 'Excluir'; fundo.querySelector('#merr').textContent = 'Senha incorreta.'; inp.value = ''; inp.focus(); return; }
      fechar(true);
    };
  });
}
const go = r => { location.hash = r; };

// ---------- layout ----------
function carregarMenu(forcar = false) {
  if (!forcar && st.menuP && Date.now() - st.menuEm < 60000) return st.menuP;
  st.menuEm = Date.now();
  st.menuP = Promise.all([
    sb.from('alertas').select('id', { count: 'exact', head: true }).is('resolvido_em', null),
    sb.from('robo_status').select('ultimo_sinal').eq('id', 'principal').maybeSingle(),
    sb.from('computadores').select('*').order('nome'),
    sb.from('extensao_versoes').select('versao').eq('principal', true).maybeSingle(),
  ]);
  return st.menuP;
}

// Troca de tela instantânea: mantém o menu e mostra "carregando" enquanto busca os dados
function mostrarCarregando() {
  const m = root.querySelector('main');
  if (m) m.innerHTML = '<div class="empty" style="padding:80px">Carregando…</div>';
  const side = root.querySelector('#side'); if (side) side.classList.remove('open');
}

async function layout(ativo, conteudo) {
  const [{ count }, robo, pcsR, princR] = await carregarMenu();
  const pcs = pcsR?.data || [], pcsOn = pcs.filter(pcOnline);
  const atrasados = princR?.data ? pcs.filter(p => desatualizado(p, princR.data.versao)).length : 0;
  const parados = pcs.filter(p => p.verificacao_desde && pcOnline(p));
  const online = robo.data?.ultimo_sinal && (Date.now() - new Date(robo.data.ultimo_sinal)) < 5 * 60 * 1000;
  const itens = eAdmin()
    ? [['#/', 'Painel geral', 'painel'], ['#/entregas', 'Visão de entregas', 'entregas'], ['#/escritorios', 'Escritórios', 'escritorios'],
       ['#/alertas', 'Alertas', 'alertas'], ['#/acesso', 'Acesso à Sefaz', 'acesso'], ['#/atualizacoes', 'Atualizações', 'atualizacoes']]
    : [['#/escritorio/' + st.perfil.escritorio_id, 'Meu escritório', 'escritorios'], ['#/entregas', 'Entregas', 'entregas'],
       ['#/alertas', 'Alertas', 'alertas'], ['#/acesso', 'Acesso à Sefaz', 'acesso'], ['#/rotina/' + st.perfil.escritorio_id, 'Rotina automática', 'rotina']];
  root.innerHTML = `
  <div class="app">
    <aside class="side" id="side">
      <div class="brand"><i>${ICON}</i>Automação de Notas</div>
      <nav class="nav">${itens.map(([href, label, k]) =>
        `<a href="${href}" class="${k === ativo ? 'on' : ''}">${label}${k === 'alertas' && count ? ` <span class="badge">${count}</span>` : ''}${k === 'atualizacoes' && atrasados ? ` <span class="badge" style="background:var(--gold)">${atrasados}</span>` : ''}</a>`).join('')}</nav>
      <div class="me">
        <div class="robo"><span class="dot ${online ? 'on' : ''}"></span>Robô ${online ? 'online' : 'offline'}</div>
        <div>${robo.data?.ultimo_sinal ? 'Último sinal: ' + quando(robo.data.ultimo_sinal) : 'Robô ainda não instalado'}</div>
        ${pcs.length ? `<div class="robo" style="border-top:1px solid #34507E;padding-top:8px"><span class="dot ${pcsOn.length ? 'on' : ''}"></span>Extensões: ${pcsOn.length} online</div>
        <div style="font-size:12px">${pcs.map(p => `${h(p.nome)} ${pcOnline(p) ? '●' : '○'}`).join(' · ')}</div>` : ''}
        <div style="border-top:1px solid #34507E;padding-top:8px">${h(st.perfil.nome || st.perfil.email)}</div>
        <button type="button" id="sair">Sair</button>
      </div>
    </aside>
    <main>
      <button type="button" class="btn menu-btn" id="menu" aria-label="Abrir menu">☰</button>
      ${parados.map(p => `<div class="card" style="background:var(--err-bg);border-color:#F1B8B2;padding:14px 18px;color:#7A1A12;font-size:14px"><b>${h(p.nome)} parou na verificação "Confirme que é humano".</b> Entre por acesso remoto nele e clique na caixinha da aba da Sefaz; o download continua sozinho.</div>`).join('')}
      ${conteudo}
    </main>
  </div>`;
  $('#sair').onclick = async () => { await sb.auth.signOut(); };
  $('#menu').onclick = () => $('#side').classList.toggle('open');
}

// ---------- login ----------
function telaLogin(erro = '') {
  root.innerHTML = `
  <div class="login"><form class="card" id="f">
    <div class="brand" style="color:var(--ink);padding:0"><i>${ICON}</i>Automação de Notas</div>
    <h1 style="font-size:22px">Entrar</h1>
    ${erro ? `<div class="msg err">${h(erro)}</div>` : ''}
    <label class="f">E-mail<input type="email" name="email" required autocomplete="email"></label>
    <label class="f">Senha<input type="password" name="senha" required autocomplete="current-password"></label>
    <button class="btn p" type="submit">Entrar</button>
    <button class="btn" type="button" id="esqueci">Esqueci minha senha</button>
  </form></div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { error } = await sb.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('senha') });
    if (error) telaLogin(error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message)
      ? 'Esse login ainda não foi confirmado. No Supabase, em Authentication → Users, confirme o usuário (ou crie de novo marcando Auto Confirm User).'
      : 'E-mail ou senha incorretos. Se o login ainda não existe, ele precisa ser criado no Supabase (Authentication → Users → Add user).');
  };
  $('#esqueci').onclick = async () => {
    const email = $('[name=email]').value;
    if (!email) return toast('Digite seu e-mail primeiro.');
    await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    toast('Enviamos um link para seu e-mail.');
  };
}

function telaNovaSenha() {
  root.innerHTML = `
  <div class="login"><form class="card" id="f">
    <h1 style="font-size:22px">Criar nova senha</h1>
    <label class="f">Nova senha<input type="password" name="senha" minlength="8" required autocomplete="new-password"></label>
    <button class="btn p" type="submit">Salvar</button>
  </form></div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    await q(sb.auth.updateUser({ password: new FormData(e.target).get('senha') }));
    toast('Senha alterada.'); go('#/'); rota();
  };
}

// ---------- dados comuns ----------
async function carregarBase(escritorioId) {
  let emp = sb.from('empresas').select('*').eq('ativa', true).order('razao_social');
  if (escritorioId) emp = emp.eq('escritorio_id', escritorioId);
  let dl = sb.from('downloads').select('empresa_id,tipo,status,qtd_notas,mensagem,atualizado_em').eq('competencia', st.comp).order('atualizado_em');
  if (escritorioId) dl = dl.eq('escritorio_id', escritorioId);
  const [escritorios, empresas, downloads, entregas] = await Promise.all([
    q(sb.from('escritorios').select('*').order('nome')),
    q(emp), q(dl),
    q(sb.from('entregas').select('empresa_id,obrigacao,status').eq('competencia', st.comp)),
  ]);
  // último download de cada empresa/tipo
  const dlMap = {};
  for (const d of downloads) dlMap[d.empresa_id + d.tipo] = d;
  const entMap = {};
  for (const e of entregas) entMap[e.empresa_id + e.obrigacao] = e.status;
  return { escritorios, empresas, dlMap, entMap };
}
const statusEnt = (b, emp, ob) => b.entMap[emp.id + ob] || (emp.obrigacoes.includes(ob) ? 'pendente' : 'na');
function statusDownload(b, emp) {
  if (!emp.ie) return ['na', 'Sem IE'];
  const e = b.dlMap[emp.id + 'entrada'], s = b.dlMap[emp.id + 'saida'];
  const lista = [emp.baixar_entrada && e, emp.baixar_saida && s].filter(x => x !== false);
  if (!lista.length) return ['na', 'Desligado'];
  if (lista.some(x => !x)) return ['na', 'Não baixado'];
  if (lista.some(x => x.status === 'erro')) return ['er', 'Erro'];
  if (lista.some(x => ['fila', 'processando'].includes(x.status))) return ['pe', 'Na fila'];
  if (lista.some(x => x.status === 'sem_notas')) return ['pe', 'Atenção'];
  return ['ok', 'OK'];
}
const qtd = (b, emp, tipo) => { const d = b.dlMap[emp.id + tipo]; return d && d.status !== 'erro' ? (d.qtd_notas ?? 0) : null; };

window.addEventListener('message', e => {
  if (e.source === window && e.data?.tipo === 'automacao-notas:erro') toast('Extensão: ' + e.data.msg);
});

// ---------- computadores com a extensão (baixar em outro computador) ----------
const pcOnline = p => !!p?.ultimo_sinal && Date.now() - new Date(p.ultimo_sinal) < 3 * 60 * 1000;
const temExtensaoAqui = () => !!document.documentElement.dataset.automacaoNotas;
const meuPc = () => document.documentElement.dataset.automacaoPc || null;   // extensão 3.8.0+ informa qual é este computador
async function carregarPcs() { const { data } = await sb.from('computadores').select('*').order('nome'); return data || []; }
// Compara versões (3.8.1 > 3.8.0 > 3.7.7). Sem versão informada conta como desatualizado.
const cmpVer = (a, b) => { const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
const desatualizado = (p, principal) => !!principal && cmpVer(p.versao, principal) < 0;
// Janela de confirmação (Cancelar / ação em vermelho). Devolve true se confirmou.
function confirmar(titulo, texto, botao) {
  return new Promise(resolve => {
    const fundo = document.createElement('div'); fundo.className = 'modal-fundo';
    fundo.innerHTML = `<div class="card modal" role="dialog" aria-modal="true"><h2>${h(titulo)}</h2><div style="font-size:14px;color:var(--ink2)">${h(texto)}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="mcanc">Cancelar</button><button type="button" class="btn del" id="mok">${h(botao)}</button></div></div>`;
    document.body.appendChild(fundo);
    const fechar = ok => { fundo.remove(); resolve(ok); };
    fundo.querySelector('#mcanc').onclick = () => fechar(false);
    fundo.querySelector('#mok').onclick = () => fechar(true);
    fundo.onclick = e => { if (e.target === fundo) fechar(false); };
    fundo.querySelector('#mok').focus();
  });
}
async function excluirPc(pc) {
  if (!await confirmar(`Excluir ${pc.nome}?`, 'Ele sai da lista e do "Baixar em". Pedidos que estavam esperando por ele são cancelados.', 'Excluir computador')) return false;
  await q(sb.from('computadores').delete().eq('id', pc.id));
  toast(`${pc.nome} excluído.`); carregarMenu(true); return true;
}
const lerLocal = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const gravarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
// '' = este computador; senão, id do computador escolhido
function pcEscolhido(es, pcs) {
  const outros = pcs.filter(p => p.id !== meuPc());
  const salvo = lerLocal('automacao-pc:' + es.id) ?? es.pc_padrao ?? null;
  if (salvo === '' && temExtensaoAqui()) return '';
  if (salvo && outros.some(p => p.id === salvo)) return salvo;
  if (temExtensaoAqui() || !outros.length) return '';
  return (outros.find(pcOnline) || outros[0]).id;
}
function seletorPc(es, pcs) {
  const outros = pcs.filter(p => p.id !== meuPc());
  if (!pcs.length) return '';   // nenhum computador com a extensão cadastrado: tudo como antes
  const atual = pcEscolhido(es, pcs);
  const este = pcs.find(p => p.id === meuPc());
  return `<label class="f">Baixar em<select id="pc" style="min-width:230px">
    ${temExtensaoAqui() ? `<option value="" ${atual === '' ? 'selected' : ''}>● Este computador${este ? ` (${h(este.nome)})` : ''}</option>` : ''}
    ${outros.map(p => `<option value="${p.id}" ${p.id === atual ? 'selected' : ''}>${pcOnline(p) ? '●' : '○'} ${h(p.nome)} (${pcOnline(p) ? 'online' : 'offline'})</option>`).join('')}
  </select></label>`;
}
function ligarSeletorPc(escritorioId) {
  const sel = $('#pc'); if (!sel) return;
  sel.onchange = async () => {
    gravarLocal('automacao-pc:' + escritorioId, sel.value);
    if (sel.value && eAdmin()) await sb.from('escritorios').update({ pc_padrao: sel.value }).eq('id', escritorioId);
  };
}

async function pedirExecucao(escritorioId, ie = null) {
  const pcs = await carregarPcs();
  const { data: es } = await sb.from('escritorios').select('id,pc_padrao').eq('id', escritorioId).maybeSingle();
  const alvo = pcEscolhido(es || { id: escritorioId }, pcs);
  if (alvo) {
    // Outro computador: o pedido fica no banco e a extensão de lá pega sozinha.
    const pc = pcs.find(p => p.id === alvo);
    await q(sb.from('execucoes').insert({ escritorio_id: escritorioId, origem: 'manual', status: 'aguardando_pc', pc_id: alvo, competencia: st.comp, ie }));
    toast(pcOnline(pc)
      ? `Pedido enviado ao ${pc.nome} (extensão online). O download começa em até 1 minuto; acompanhe na Rotina.`
      : `${pc.nome} está offline (desligado ou com o Chrome fechado). O pedido fica guardado e roda quando ele ligar.`);
    return;
  }
  const temExtensao = temExtensaoAqui();
  const exe = await q(sb.from('execucoes').insert({ escritorio_id: escritorioId, origem: 'manual', status: 'pendente' }).select('id').single());   // igual à 3.7.7
  if (temExtensao) {
    // Extensão do Chrome instalada: ela faz o login na Sefaz e baixa as notas.
    const pedido = { escritorio_id: escritorioId, execucao_id: exe.id, ie, comp: st.comp };   // competência escolhida no painel
    window.postMessage({ tipo: 'automacao-notas:executar', ...pedido, abriu: false }, location.origin);
    toast('Download iniciado numa aba da Sefaz em segundo plano. Se precisar da verificação, aparece um aviso no canto da tela.');
  } else {
    toast('Pedido enviado. Instale a extensão "Automação de Notas" no Chrome (ou ligue o robô) para baixar.');
  }
}

// ---------- painel geral (admin) ----------
async function telaPainel() {
  if (!eAdmin()) return go('#/escritorio/' + st.perfil.escritorio_id);
  const b = await carregarBase();
  const alertas = await q(sb.from('alertas').select('*, escritorios(nome), empresas(razao_social)').is('resolvido_em', null).order('criado_em', { ascending: false }).limit(6));
  let totE = 0, totS = 0, comErro = 0;
  const porEsc = b.escritorios.map(es => {
    const emps = b.empresas.filter(e => e.escritorio_id === es.id);
    let ne = 0, ns = 0, erro = 0, fila = 0, emDia = 0;
    for (const e of emps) {
      ne += qtd(b, e, 'entrada') || 0; ns += qtd(b, e, 'saida') || 0;
      const [c] = statusDownload(b, e); if (c === 'er') erro++; if (c === 'pe') fila++;
      if (OBRIG.every(([k]) => !['pendente', 'atrasado'].includes(statusEnt(b, e, k)))) emDia++;
    }
    totE += ne; totS += ns; comErro += erro;
    return { es, emps, ne, ns, erro, fila, emDia };
  });
  await layout('painel', `
    <div class="top">
      <div><div class="sub">Visão de todos os escritórios · competência ${compNome(st.comp)}</div><h1>Painel geral</h1></div>
      <div class="filters">
        <label class="f">Competência<select id="comp">${compOpcoes()}</select></label>
        <a class="btn p" href="#/escritorios" style="display:inline-flex;align-items:center;text-decoration:none">+ Novo escritório</a>
      </div>
    </div>
    <section class="kpis">
      <div class="card pad kpi"><div class="l">Escritórios</div><div class="v">${b.escritorios.length}</div></div>
      <div class="card pad kpi"><div class="l">Empresas ativas</div><div class="v">${b.empresas.length}</div></div>
      <div class="card pad kpi"><div class="l">Notas baixadas</div><div class="v">${n(totE + totS)}</div><div class="sub">${n(totE)} entrada · ${n(totS)} saída</div></div>
      <div class="card pad kpi ${comErro ? 'bad' : ''}"><div class="l">Empresas com erro</div><div class="v">${comErro}</div></div>
    </section>
    <section class="cols">
      <div class="card tbl-wrap">
        <div class="pad" style="padding-bottom:8px"><h2>Escritórios</h2></div>
        ${porEsc.length ? `<table class="tbl"><thead><tr><th>Escritório</th><th class="c">Empresas</th><th class="c">Notas E / S</th><th>Downloads</th><th>Entregas em dia</th></tr></thead><tbody>
        ${porEsc.map(r => `<tr class="click" data-href="#/escritorio/${r.es.id}"><td><a href="#/escritorio/${r.es.id}" style="font-weight:600">${h(r.es.nome)}</a></td>
          <td class="c">${r.emps.length}</td><td class="c">${n(r.ne)} / ${n(r.ns)}</td>
          <td>${r.erro ? `<span class="pill er">${r.erro} com erro</span>` : r.fila ? `<span class="pill pe">${r.fila} pendente(s)</span>` : `<span class="pill ok">Tudo ok</span>`}</td>
          <td><span class="bar"><span style="width:${r.emps.length ? Math.round(r.emDia / r.emps.length * 100) : 0}%"></span></span> ${r.emDia} de ${r.emps.length}</td></tr>`).join('')}
        </tbody></table>` : `<div class="empty">Nenhum escritório ainda. <a href="#/escritorios">Cadastre o primeiro</a>.</div>`}
      </div>
      <div class="card pad" style="display:flex;flex-direction:column;gap:14px">
        <h2>Alertas abertos</h2>
        ${alertas.length ? alertas.map(a => `<div style="display:flex;gap:10px;align-items:flex-start"><span class="pill ${a.tipo === 'erro' ? 'er' : a.tipo === 'mudanca' ? 'mu' : 'pe'}">${a.tipo === 'erro' ? 'Erro' : a.tipo === 'mudanca' ? 'Mudança' : 'Aviso'}</span>
          <div style="font-size:14px"><b>${h(a.escritorios?.nome || '')}</b> · ${h(a.titulo)}<div class="d">${h(a.detalhe || '')}</div></div></div>`).join('') : '<div class="sub">Nenhum alerta aberto.</div>'}
        <a href="#/alertas" style="font-size:14px;font-weight:600">Ver todos os alertas</a>
      </div>
    </section>`);
  $('#comp').onchange = e => { st.comp = e.target.value; telaPainel(); };
  $$('tr.click').forEach(tr => tr.onclick = ev => { if (ev.target.tagName !== 'A') go(tr.dataset.href); });
}

// ---------- visão de entregas ----------
async function telaEntregas(filtro = { esc: '', mostrar: 'todas', busca: '' }) {
  const b = await carregarBase(eAdmin() ? null : st.perfil.escritorio_id);
  const totais = Object.fromEntries(OBRIG.map(([k]) => [k, { ok: 0, tot: 0 }]));
  for (const e of b.empresas) for (const [k] of OBRIG) {
    const s = statusEnt(b, e, k); if (s !== 'na') { totais[k].tot++; if (s === 'ok') totais[k].ok++; }
  }
  const busca = filtro.busca.toLowerCase();
  const visivel = e => {
    if (filtro.esc && e.escritorio_id !== filtro.esc) return false;
    if (busca && ![e.razao_social, e.cnpj, e.ie, e.codigo].some(x => String(x || '').toLowerCase().includes(busca))) return false;
    if (filtro.mostrar === 'pendencia' && !OBRIG.some(([k]) => ['pendente', 'atrasado'].includes(statusEnt(b, e, k)))) return false;
    if (filtro.mostrar === 'erro' && statusDownload(b, e)[0] !== 'er') return false;
    return true;
  };
  const linhas = b.escritorios.map(es => {
    const todas = b.empresas.filter(e => e.escritorio_id === es.id);
    const emps = todas.filter(visivel);
    if (!emps.length) return '';
    const emDia = todas.filter(e => OBRIG.every(([k]) => !['pendente', 'atrasado'].includes(statusEnt(b, e, k)))).length;
    return `<tr class="grp"><td colspan="4">${h(es.nome)} · ${todas.length} empresas</td><td colspan="${OBRIG.length}" style="text-align:right"><span class="bar"><span style="width:${todas.length ? Math.round(emDia / todas.length * 100) : 0}%"></span></span> ${emDia} de ${todas.length} em dia</td></tr>` +
      emps.map(e => {
        const [dc, dl] = statusDownload(b, e);
        const qe = qtd(b, e, 'entrada'), qs = qtd(b, e, 'saida');
        return `<tr><td><a href="#/empresa/${e.id}">${h(e.razao_social)}</a></td><td>${REGIMES[e.regime] || '—'}</td>
          <td class="c">${qe == null && qs == null ? '—' : `${qe ?? '—'} / ${qs ?? '—'}`}</td><td class="c"><span class="pill ${dc}">${dl}</span></td>
          ${OBRIG.map(([k]) => { const s = statusEnt(b, e, k); return `<td class="c"><button type="button" class="s ${ST_ENT[s][0]}" data-emp="${e.id}" data-ob="${k}" data-st="${s}" title="Clique para mudar">${ST_ENT[s][1]}</button></td>`; }).join('')}</tr>`;
      }).join('');
  }).join('');
  await layout('entregas', `
    <div class="top">
      <div><div class="sub">${eAdmin() ? 'Todas as empresas de todos os escritórios' : 'Empresas do seu escritório'}</div><h1>Visão geral de entregas</h1></div>
      <button type="button" class="btn" id="exportar">Exportar Excel</button>
    </div>
    <section class="kpis">${OBRIG.map(([k, l]) => `<div class="card kpi" style="padding:14px"><div class="l">${l}</div><div class="v" style="font-size:20px">${totais[k].ok}<small> / ${totais[k].tot}</small></div></div>`).join('')}</section>
    <div class="filters">
      <label class="f">Competência<select id="comp">${compOpcoes()}</select></label>
      ${eAdmin() ? `<label class="f">Escritório<select id="fesc"><option value="">Todos</option>${b.escritorios.map(e => `<option value="${e.id}" ${e.id === filtro.esc ? 'selected' : ''}>${h(e.nome)}</option>`).join('')}</select></label>` : ''}
      <label class="f">Mostrar<select id="fmos"><option value="todas">Todas as empresas</option><option value="pendencia" ${filtro.mostrar === 'pendencia' ? 'selected' : ''}>Só com pendência</option><option value="erro" ${filtro.mostrar === 'erro' ? 'selected' : ''}>Só com erro no download</option></select></label>
      <label class="f">Buscar<input id="fbus" type="text" placeholder="Empresa, CNPJ ou IE" value="${h(filtro.busca)}" style="width:240px"></label>
    </div>
    <div class="card tbl-wrap">${linhas ? `<table class="tbl" id="tab"><thead><tr><th>Escritório / Empresa</th><th>Regime</th><th class="c">Notas E / S</th><th class="c">Download</th>${OBRIG.map(([, l]) => `<th class="c">${l}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table>` : '<div class="empty">Nenhuma empresa para mostrar.</div>'}</div>
    <div class="sub">Clique num status para trocar: Pendente → OK → N/A → Atraso.</div>`);
  const recarregar = () => telaEntregas({ esc: $('#fesc')?.value || '', mostrar: $('#fmos').value, busca: $('#fbus').value });
  $('#comp').onchange = e => { st.comp = e.target.value; recarregar(); };
  if ($('#fesc')) $('#fesc').onchange = recarregar;
  $('#fmos').onchange = recarregar;
  $('#fbus').onchange = recarregar;
  $$('button.s').forEach(bt => bt.onclick = async () => {
    const novo = CICLO[bt.dataset.st];
    await q(sb.from('entregas').upsert({ empresa_id: bt.dataset.emp, competencia: st.comp, obrigacao: bt.dataset.ob, status: novo, atualizado_por: st.session.user.id, atualizado_em: new Date().toISOString() }));
    bt.dataset.st = novo; bt.className = 's ' + ST_ENT[novo][0]; bt.textContent = ST_ENT[novo][1];
  });
  $('#exportar').onclick = async () => {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    const ws = XLSX.utils.table_to_sheet($('#tab'));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Entregas');
    XLSX.writeFile(wb, `entregas-${st.comp.slice(0, 7)}.xlsx`);
  };
}

// ---------- escritórios (admin) ----------
async function telaEscritorios() {
  if (!eAdmin()) return go('#/escritorio/' + st.perfil.escritorio_id);
  const [escs, emps, creds] = await Promise.all([
    q(sb.from('escritorios').select('*').order('nome')),
    q(sb.from('empresas').select('escritorio_id').eq('ativa', true)),
    q(sb.from('credenciais_sefaz').select('escritorio_id,situacao')),
  ]);
  const sit = Object.fromEntries(creds.map(c => [c.escritorio_id, c.situacao]));
  await layout('escritorios', `
    <div class="top"><div><div class="sub">Clientes contadores</div><h1>Escritórios</h1></div></div>
    <section class="cols">
      <div class="card tbl-wrap">${escs.length ? `<table class="tbl"><thead><tr><th>Escritório</th><th>CNPJ</th><th class="c">Empresas</th><th>Acesso Sefaz</th><th></th></tr></thead><tbody>
        ${escs.map(e => `<tr class="click" data-href="#/escritorio/${e.id}"><td><a href="#/escritorio/${e.id}" style="font-weight:600">${h(e.nome)}</a></td><td>${h(e.cnpj || '—')}</td>
          <td class="c">${emps.filter(x => x.escritorio_id === e.id).length}</td><td>${pillSefaz(sit[e.id])}</td><td style="text-align:right"><button type="button" class="btn s" data-editar="${e.id}">Editar</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Nenhum escritório cadastrado ainda.</div>'}</div>
      <form class="card pad" id="novo" style="display:flex;flex-direction:column;gap:14px">
        <h2>Novo escritório</h2>
        <label class="f">Nome<input name="nome" required></label>
        <label class="f">CNPJ<input name="cnpj"></label>
        <label class="f">E-mail de contato<input name="email_contato" type="email"></label>
        <button class="btn p" type="submit">Cadastrar</button>
      </form>
    </section>`);
  $$('tr.click').forEach(tr => tr.onclick = ev => { if (!['A', 'BUTTON'].includes(ev.target.tagName)) go(tr.dataset.href); });
  $$('[data-editar]').forEach(bt => bt.onclick = async () => {
    if (await editarEscritorio(escs.find(e => e.id === bt.dataset.editar))) telaEscritorios();
  });
  $('#novo').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const [es] = await q(sb.from('escritorios').insert(fd).select());
    toast('Escritório cadastrado.'); go('#/escritorio/' + es.id);
  };
}
function pillSefaz(s) {
  return { ok: '<span class="pill ok">Funcionando</span>', recusada: '<span class="pill er">Senha recusada</span>', erro: '<span class="pill er">Erro</span>', nao_testado: '<span class="pill pe">Não testado</span>' }[s] || '<span class="pill na">Não cadastrado</span>';
}

// ---------- escritório ----------
async function telaEscritorio(id, aba = 'empresas') {
  if (!eAdmin() && id !== st.perfil.escritorio_id) return go('#/escritorio/' + st.perfil.escritorio_id);
  const [b, cred, pcs] = await Promise.all([carregarBase(id), q(sb.from('credenciais_sefaz').select('*').eq('escritorio_id', id).maybeSingle()), carregarPcs()]);
  const es = b.escritorios.find(e => e.id === id);
  if (!es) return layout('escritorios', '<div class="empty">Escritório não encontrado.</div>');
  let ne = 0, ns = 0, emDia = 0;
  for (const e of b.empresas) {
    ne += qtd(b, e, 'entrada') || 0; ns += qtd(b, e, 'saida') || 0;
    if (OBRIG.every(([k]) => !['pendente', 'atrasado'].includes(statusEnt(b, e, k)))) emDia++;
  }
  let corpo = '';
  if (aba === 'empresas') {
    corpo = `<div class="card tbl-wrap">${b.empresas.length ? `<table class="tbl"><thead><tr><th>Cód.</th><th>Empresa</th><th>IE</th><th>CNPJ</th><th>Regime</th><th class="c">Entrada</th><th class="c">Saída</th><th>Download</th><th></th></tr></thead><tbody>
      ${b.empresas.map(e => { const [c, l] = statusDownload(b, e); return `<tr class="click" data-href="#/empresa/${e.id}"><td>${h(e.codigo || '')}</td><td style="font-weight:600">${h(e.razao_social)}</td><td>${h(e.ie || '—')}</td><td>${h(e.cnpj || '—')}</td><td>${REGIMES[e.regime] || '—'}</td>
        <td class="c">${qtd(b, e, 'entrada') ?? '—'}</td><td class="c">${qtd(b, e, 'saida') ?? '—'}</td><td><span class="pill ${c}">${l}</span></td><td style="text-align:right;white-space:nowrap">${e.ie ? `<button type="button" class="btn s" data-baixar-ie="${h(e.ie)}" title="Baixar só esta empresa">Baixar</button> ` : ''}<a class="btn s" href="#/empresa/${e.id}" style="display:inline-flex;align-items:center;text-decoration:none">Editar</a></td></tr>`; }).join('')}
      </tbody></table>` : `<div class="empty">Nenhuma empresa ainda. <a href="#/empresa/novo?esc=${id}">Cadastre</a> ou importe sua planilha.</div>`}</div>`;
  } else if (aba === 'downloads') {
    const dls = await q(sb.from('downloads').select('*, empresas(razao_social)').eq('escritorio_id', id).order('atualizado_em', { ascending: false }).limit(100));
    corpo = `<div class="card tbl-wrap">${dls.length ? `<table class="tbl"><thead><tr><th>Quando</th><th>Empresa</th><th>Competência</th><th>Tipo</th><th class="c">Notas</th><th>Situação</th><th>Detalhe</th></tr></thead><tbody>
      ${dls.map(d => `<tr><td>${quando(d.atualizado_em)}</td><td>${h(d.empresas?.razao_social)}</td><td>${compNome(d.competencia)}</td><td>${d.tipo === 'entrada' ? 'Entrada' : 'Saída'}</td><td class="c">${d.qtd_notas ?? '—'}</td>
        <td><span class="pill ${ST_DL[d.status][0]}">${ST_DL[d.status][1]}</span></td><td class="sub">${h(d.mensagem || d.arquivo || '')}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Nenhum download ainda.</div>'}</div>`;
  } else if (aba === 'usuarios') {
    const perfis = eAdmin() ? await q(sb.from('perfis').select('*').order('email')) : [];
    const doEsc = perfis.filter(p => p.escritorio_id === id);
    const livres = perfis.filter(p => !p.escritorio_id && p.papel !== 'admin');
    corpo = `<div class="cols"><div class="card tbl-wrap">${doEsc.length ? `<table class="tbl"><thead><tr><th>Nome</th><th>E-mail</th><th></th></tr></thead><tbody>
      ${doEsc.map(p => `<tr><td>${h(p.nome)}</td><td>${h(p.email)}</td><td style="text-align:right"><button type="button" class="btn s" data-tirar="${p.user_id}">Remover acesso</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Ninguém deste escritório tem acesso ainda.</div>'}</div>
      <div class="card pad" style="display:flex;flex-direction:column;gap:12px"><h2>Dar acesso</h2>
        <div class="sub">1. No Supabase, em Authentication → Users, use "Invite user" com o e-mail da pessoa.<br>2. Depois que ela entrar, ela aparece aqui para você ligar a este escritório.</div>
        ${livres.length ? `<label class="f">Usuário<select id="livre">${livres.map(p => `<option value="${p.user_id}">${h(p.email)}</option>`).join('')}</select></label><button type="button" class="btn p" id="ligar">Ligar a ${h(es.nome)}</button>` : '<div class="sub">Nenhum usuário novo esperando.</div>'}
      </div></div>`;
  }
  await layout(eAdmin() ? 'escritorios' : 'escritorios', `
    <div class="top">
      <div>
        ${eAdmin() ? `<div class="sub"><a href="#/escritorios">Escritórios</a> / ${h(es.nome)}</div>` : ''}
        <h1>${h(es.nome)}</h1>
        <div style="display:flex;gap:10px;align-items:center;margin-top:6px;flex-wrap:wrap" class="sub">${pillSefaz(cred?.situacao)} ${cred ? `<span>Contador: CPF ${mascCpf(cred.cpf)}</span>` : ''} <a href="#/acesso?esc=${id}">Alterar acesso</a></div>
      </div>
      <div class="filters">
        <label class="f">Competência<select id="comp">${compOpcoes()}</select></label>
        <a class="btn" href="#/rotina/${id}" style="display:inline-flex;align-items:center;text-decoration:none">Rotina</a>
        ${seletorPc(es, pcs)}
        <button type="button" class="btn" id="baixar">Baixar agora</button>
        <a class="btn p" href="#/empresa/novo?esc=${id}" style="display:inline-flex;align-items:center;text-decoration:none">+ Nova empresa</a>
        ${eAdmin() ? '<button type="button" class="btn" id="editarEsc">Editar escritório</button><button type="button" class="btn del-o" id="excluirEsc">Excluir escritório</button>' : ''}
      </div>
    </div>
    <section class="kpis">
      <div class="card pad kpi"><div class="l">Empresas</div><div class="v">${b.empresas.length}</div></div>
      <div class="card pad kpi"><div class="l">Notas de entrada</div><div class="v">${n(ne)}</div></div>
      <div class="card pad kpi"><div class="l">Notas de saída</div><div class="v">${n(ns)}</div></div>
      <div class="card pad kpi"><div class="l">Entregas em dia</div><div class="v">${emDia}<small> de ${b.empresas.length}</small></div></div>
    </section>
    <div class="tabs">
      <button type="button" class="tab ${aba === 'empresas' ? 'on' : ''}" data-aba="empresas">Empresas</button>
      <button type="button" class="tab ${aba === 'downloads' ? 'on' : ''}" data-aba="downloads">Downloads</button>
      ${eAdmin() ? `<button type="button" class="tab ${aba === 'usuarios' ? 'on' : ''}" data-aba="usuarios">Usuários do escritório</button>` : ''}
    </div>
    ${corpo}`);
  $('#comp').onchange = e => { st.comp = e.target.value; telaEscritorio(id, aba); };
  $$('[data-aba]').forEach(t => t.onclick = () => telaEscritorio(id, t.dataset.aba));
  $$('tr.click').forEach(tr => tr.onclick = () => go(tr.dataset.href));
  ligarSeletorPc(id);
  $('#baixar').onclick = () => pedirExecucao(id);
  $$('[data-baixar-ie]').forEach(bt => bt.onclick = ev => { ev.stopPropagation(); pedirExecucao(id, bt.dataset.baixarIe); });
  if ($('#editarEsc')) $('#editarEsc').onclick = async () => {
    if (await editarEscritorio(es)) telaEscritorio(id, aba);
  };
  if ($('#excluirEsc')) $('#excluirEsc').onclick = async () => {
    const ok = await confirmarComSenha(`Excluir ${es.nome}?`, `Apaga o escritório, as ${b.empresas.length} empresas dele, o histórico de downloads, as entregas, os alertas e a senha da Sefaz. Não tem como desfazer. Os XMLs já salvos no computador continuam lá.`);
    if (!ok) return;
    await q(sb.from('escritorios').delete().eq('id', id));
    toast('Escritório excluído.'); go('#/escritorios');
  };
  if ($('#ligar')) $('#ligar').onclick = async () => {
    await q(sb.from('perfis').update({ escritorio_id: id }).eq('user_id', $('#livre').value));
    toast('Acesso liberado.'); telaEscritorio(id, 'usuarios');
  };
  $$('[data-tirar]').forEach(bt => bt.onclick = async () => {
    await q(sb.from('perfis').update({ escritorio_id: null }).eq('user_id', bt.dataset.tirar));
    telaEscritorio(id, 'usuarios');
  });
}

// ---------- empresa ----------
async function telaEmpresa(id, params) {
  const nova = id === 'novo';
  const [empBanco, escs, rotinas] = await Promise.all([
    nova ? null : q(sb.from('empresas').select('*').eq('id', id).maybeSingle()),
    q(sb.from('escritorios').select('id,nome').order('nome')),
    q(sb.from('rotinas').select('escritorio_id,pasta_destino')),
  ]);
  if (!nova && !empBanco) return naoEncontrado('Empresa não encontrada', 'Ela pode ter sido excluída, ou o link está desatualizado.');
  const emp = empBanco || { escritorio_id: params.get('esc') || st.perfil.escritorio_id, uf: 'GO', baixar_entrada: true, baixar_saida: true, incluir_eventos: true, modelo: 'todos', exibir_canceladas: false, obrigacoes: ['impt_nfs', 'apuracao'] };
  const es = escs.find(e => e.id === emp.escritorio_id);
  const rot = rotinas.find(r => r.escritorio_id === emp.escritorio_id);
  const sel = (v, a) => v === a ? 'selected' : '';
  await layout('escritorios', `
    <div class="top"><div><div class="sub"><a href="#/escritorio/${emp.escritorio_id}">${h(es?.nome || 'Escritório')}</a> / ${nova ? 'Nova empresa' : h(emp.razao_social)}</div><h1>${nova ? 'Cadastrar empresa' : 'Editar empresa'}</h1></div></div>
    <div class="cols form">
      <form id="f" style="display:flex;flex-direction:column;gap:20px">
        <section class="card pad" style="display:flex;flex-direction:column;gap:16px">
          <h2>Dados da empresa</h2>
          ${eAdmin() ? `<label class="f">Escritório<select name="escritorio_id">${escs.map(e => `<option value="${e.id}" ${sel(e.id, emp.escritorio_id)}>${h(e.nome)}</option>`).join('')}</select></label>` : ''}
          <div class="g3"><label class="f">Código<input name="codigo" value="${h(emp.codigo)}"></label>
            <label class="f" style="grid-column:span 2">Razão social<input name="razao_social" required value="${h(emp.razao_social)}"></label></div>
          <div class="g3"><label class="f">CNPJ<input name="cnpj" value="${h(emp.cnpj)}"></label>
            <label class="f">Inscrição estadual<input name="ie" value="${h(emp.ie)}" inputmode="numeric"></label>
            <label class="f">UF<input name="uf" value="${h(emp.uf)}" maxlength="2"></label></div>
          <div class="g2"><label class="f">Regime<select name="regime"><option value="">—</option>${Object.entries(REGIMES).map(([k, l]) => `<option value="${k}" ${sel(k, emp.regime)}>${l}</option>`).join('')}</select></label>
            <label class="f">Atividade<input name="atividade" value="${h(emp.atividade)}" placeholder="comércio, serviço, indústria"></label></div>
        </section>
        <section class="card pad" style="display:flex;flex-direction:column;gap:12px">
          <h2>Download de notas na Sefaz-GO</h2>
          <div class="sub">O robô usa o login do contador do escritório e a inscrição estadual acima. Sem IE, a empresa fica só no controle de entregas.</div>
          <div class="g2"><div>
            <label class="chk"><input type="checkbox" name="baixar_entrada" ${emp.baixar_entrada ? 'checked' : ''}>Baixar notas de entrada</label>
            <label class="chk"><input type="checkbox" name="baixar_saida" ${emp.baixar_saida ? 'checked' : ''}>Baixar notas de saída</label>
            <label class="chk"><input type="checkbox" name="incluir_eventos" ${emp.incluir_eventos ? 'checked' : ''}>Incluir eventos (cancelamento, CC-e)</label></div>
            <div style="display:flex;flex-direction:column;gap:12px">
            <label class="f">Modelo da NF-e<select name="modelo"><option value="todos" ${sel('todos', emp.modelo)}>Todos</option><option value="55" ${sel('55', emp.modelo)}>55 (NF-e)</option><option value="65" ${sel('65', emp.modelo)}>65 (NFC-e)</option></select></label>
            <label class="f">Notas canceladas<select name="exibir_canceladas"><option value="false">Não exibir</option><option value="true" ${emp.exibir_canceladas ? 'selected' : ''}>Exibir</option></select></label></div></div>
          <label class="f">Pasta mãe desta empresa no computador
            <input name="pasta" value="${h(emp.pasta)}" placeholder="${h(rot?.pasta_destino || 'C:\\Notas')}">
            <span class="sub" style="font-weight:400">Ex.: C:\\Clientes. Dentro dela a automação procura a pasta da empresa (pelo código ou pelo nome) e, se não achar, cria "${h(emp.codigo ? emp.codigo + ' - ' : '')}${h(emp.razao_social || 'Empresa')}". Lá dentro cria a pasta do mês (ex.: 102026) com Entrada_102026.zip e Saida_102026.zip. Em branco, usa a pasta mãe da Rotina.</span>
          </label>
        </section>
        <section class="card pad" style="display:flex;flex-direction:column;gap:8px">
          <h2>Entregas que essa empresa tem</h2>
          <div class="g3">${OBRIG.map(([k, l]) => `<label class="chk"><input type="checkbox" name="ob_${k}" ${emp.obrigacoes.includes(k) ? 'checked' : ''}>${l}</label>`).join('')}</div>
        </section>
        <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap">
          <div style="display:flex;gap:10px;flex-wrap:wrap">${nova ? '' : '<button type="button" class="btn" id="desativar">Desativar</button><button type="button" class="btn del-o" id="excluirEmp">Excluir empresa</button>'}</div>
          <div style="display:flex;gap:10px"><a class="btn" href="#/escritorio/${emp.escritorio_id}" style="display:inline-flex;align-items:center;text-decoration:none">Cancelar</a><button class="btn p" type="submit">Salvar empresa</button></div>
        </div>
      </form>
      <aside class="card pad" style="display:flex;flex-direction:column;gap:14px">
        <h2>Importar várias de uma vez</h2>
        <div style="font-size:14px;color:var(--ink2)">Envie a planilha que você usa hoje. Colunas lidas: Código, IE, CNPJ, Clientes, Regime, Atividade, UF.</div>
        <label class="btn o" style="display:inline-flex;align-items:center;justify-content:center">Importar planilha Excel<input type="file" id="arq" accept=".xlsx,.xls,.csv" hidden></label>
        <div id="imp" class="sub"></div>
      </aside>
    </div>`);
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const reg = {
      escritorio_id: fd.get('escritorio_id') || emp.escritorio_id,
      codigo: fd.get('codigo') || null, razao_social: fd.get('razao_social').trim(), cnpj: fd.get('cnpj') || null,
      ie: (fd.get('ie') || '').replace(/\D/g, '') || null, uf: (fd.get('uf') || 'GO').toUpperCase(), regime: fd.get('regime') || null,
      atividade: fd.get('atividade') || null, baixar_entrada: fd.has('baixar_entrada'), baixar_saida: fd.has('baixar_saida'),
      incluir_eventos: fd.has('incluir_eventos'), modelo: fd.get('modelo'), exibir_canceladas: fd.get('exibir_canceladas') === 'true',
      obrigacoes: OBRIG.map(([k]) => k).filter(k => fd.has('ob_' + k)),
      pasta: (fd.get('pasta') || '').trim().replace(/[\\/]+$/, '') || null,
    };
    if (nova) await q(sb.from('empresas').insert(reg)); else await q(sb.from('empresas').update(reg).eq('id', id));
    toast('Empresa salva.'); go('#/escritorio/' + reg.escritorio_id);
  };
  if ($('#excluirEmp')) $('#excluirEmp').onclick = async () => {
    const ok = await confirmarComSenha(`Excluir ${emp.razao_social}?`, 'Apaga a empresa, o histórico de downloads e as entregas dela. Não tem como desfazer. Se for só parar de baixar, use Desativar.');
    if (!ok) return;
    await q(sb.from('empresas').delete().eq('id', id));
    toast('Empresa excluída.'); go('#/escritorio/' + emp.escritorio_id);
  };
  if ($('#desativar')) $('#desativar').onclick = async () => {
    if (!confirm('Desativar esta empresa? Ela some dos painéis e o robô para de baixar.')) return;
    await q(sb.from('empresas').update({ ativa: false }).eq('id', id)); go('#/escritorio/' + emp.escritorio_id);
  };
  $('#arq').onchange = e => importarPlanilha(e.target.files[0], emp.escritorio_id);
}

async function importarPlanilha(arq, escritorioId) {
  if (!arq) return;
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const wb = XLSX.read(await arq.arrayBuffer());
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const ih = linhas.findIndex(r => r.some(c => norm(c) === 'CNPJ'));
  if (ih < 0) return $('#imp').textContent = 'Não achei a coluna CNPJ na planilha.';
  const cab = linhas[ih].map(norm);
  const col = (...nomes) => cab.findIndex(c => nomes.includes(c));
  const c = { cod: col('CODIGO', 'COD'), ie: col('IE', 'INSCRICAO ESTADUAL'), cnpj: col('CNPJ'), nome: col('CLIENTES', 'CLIENTE', 'RAZAO SOCIAL', 'EMPRESA'), reg: col('REGIME'), atv: col('ATIVIDADE'), uf: col('UF') };
  const regime = r => { const x = norm(r); return x.startsWith('SIMPLES') ? 'simples' : x.includes('PRESUMIDO') ? 'presumido' : x.includes('REAL') ? 'real' : x.includes('MEI') ? 'mei' : x ? 'outro' : null; };
  const regs = linhas.slice(ih + 1).filter(r => c.nome >= 0 && String(r[c.nome]).trim()).map(r => ({
    escritorio_id: escritorioId, codigo: c.cod >= 0 ? String(r[c.cod]).trim() || null : null,
    ie: c.ie >= 0 ? String(r[c.ie]).replace(/\D/g, '') || null : null, cnpj: c.cnpj >= 0 ? String(r[c.cnpj]).trim() || null : null,
    razao_social: String(r[c.nome]).trim(), regime: c.reg >= 0 ? regime(r[c.reg]) : null,
    atividade: c.atv >= 0 ? String(r[c.atv]).trim() || null : null, uf: c.uf >= 0 ? String(r[c.uf]).trim().toUpperCase() || 'GO' : 'GO',
    obrigacoes: ['impt_nfs', 'apuracao'].concat(c.reg >= 0 && regime(r[c.reg]) === 'simples' ? ['pgdas'] : []),
  }));
  if (!regs.length) return $('#imp').textContent = 'Nenhuma empresa encontrada na planilha.';
  if (!confirm(`Importar ${regs.length} empresas para este escritório?`)) return;
  await q(sb.from('empresas').insert(regs));
  toast(`${regs.length} empresas importadas.`); go('#/escritorio/' + escritorioId);
}

// ---------- alertas ----------
async function telaAlertas(f = { aba: 'abertos', tipo: '', esc: '' }) {
  let qr = sb.from('alertas').select('*, escritorios(nome), empresas(razao_social)').order('criado_em', { ascending: false }).limit(200);
  if (f.aba === 'abertos') qr = qr.is('resolvido_em', null);
  if (f.aba === 'resolvidos') qr = qr.not('resolvido_em', 'is', null);
  if (f.tipo) qr = qr.eq('tipo', f.tipo);
  if (f.esc) qr = qr.eq('escritorio_id', f.esc);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const [lista, abertos, resolvHoje, escs] = await Promise.all([
    q(qr), q(sb.from('alertas').select('tipo').is('resolvido_em', null)),
    sb.from('alertas').select('id', { count: 'exact', head: true }).gte('resolvido_em', hoje.toISOString()),
    q(sb.from('escritorios').select('id,nome').order('nome')),
  ]);
  const cnt = t => abertos.filter(a => a.tipo === t).length;
  const TAG = { erro: ['er', 'ERRO'], mudanca: ['mu', 'MUDANÇA'], aviso: ['pe', 'AVISO'] };
  const ACAO = { atualizar_senha: 'Atualizar senha', tentar_de_novo: 'Tentar de novo', baixar_novas: 'Baixar as novas' };
  await layout('alertas', `
    <div class="top"><div><div class="sub">Erros e mudanças de qualquer empresa${eAdmin() ? ', de todos os escritórios' : ''}</div><h1>Alertas</h1></div></div>
    <section class="kpis">
      <div class="card pad kpi"><div class="l" style="color:#9B1C12;font-weight:600">Erros</div><div class="v">${cnt('erro')}</div><div class="sub">precisam de ação</div></div>
      <div class="card pad kpi"><div class="l" style="color:var(--navy);font-weight:600">Mudanças</div><div class="v">${cnt('mudanca')}</div><div class="sub">notas ou cadastro alterados</div></div>
      <div class="card pad kpi"><div class="l" style="color:#6B4A00;font-weight:600">Avisos</div><div class="v">${cnt('aviso')}</div><div class="sub">vale conferir</div></div>
      <div class="card pad kpi"><div class="l" style="color:#10592F;font-weight:600">Resolvidos hoje</div><div class="v">${resolvHoje.count || 0}</div></div>
    </section>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line)">
      <div style="display:flex;gap:4px">${[['abertos', `Abertos (${abertos.length})`], ['resolvidos', 'Resolvidos'], ['todos', 'Todos']].map(([k, l]) => `<button type="button" class="tab ${f.aba === k ? 'on' : ''}" data-aba="${k}" style="border-bottom-width:2px">${l}</button>`).join('')}</div>
      <div class="filters" style="padding-bottom:8px">
        <label class="f">Tipo<select id="ftipo"><option value="">Todos</option><option value="erro" ${f.tipo === 'erro' ? 'selected' : ''}>Erro</option><option value="mudanca" ${f.tipo === 'mudanca' ? 'selected' : ''}>Mudança</option><option value="aviso" ${f.tipo === 'aviso' ? 'selected' : ''}>Aviso</option></select></label>
        ${eAdmin() ? `<label class="f">Escritório<select id="fesc"><option value="">Todos</option>${escs.map(e => `<option value="${e.id}" ${e.id === f.esc ? 'selected' : ''}>${h(e.nome)}</option>`).join('')}</select></label>` : ''}
      </div>
    </div>
    <section class="card">${lista.length ? lista.map(a => `
      <div class="alert-row"><span class="tag ${TAG[a.tipo][0]}">${TAG[a.tipo][1]}</span>
        <div><div class="t">${h(a.titulo)}</div><div class="d">${h([a.escritorios?.nome, a.empresas?.razao_social].filter(Boolean).join(' · '))}${a.detalhe ? ' · ' + h(a.detalhe) : ''}</div></div>
        <div class="d">${quando(a.criado_em)}${a.resolvido_em ? '<br>resolvido ' + quando(a.resolvido_em) : ''}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          ${!a.resolvido_em && a.acao && ACAO[a.acao] ? `<button type="button" class="btn s p" data-acao="${a.acao}" data-esc="${a.escritorio_id}" data-id="${a.id}">${ACAO[a.acao]}</button>` : ''}
          ${!a.resolvido_em ? `<button type="button" class="btn s" data-resolver="${a.id}">Resolvido</button>` : ''}
        </div></div>`).join('') : '<div class="empty">Nenhum alerta aqui.</div>'}</section>`);
  const rec = (mud = {}) => telaAlertas({ aba: f.aba, tipo: $('#ftipo').value, esc: $('#fesc')?.value || '', ...mud });
  $$('[data-aba]').forEach(t => t.onclick = () => rec({ aba: t.dataset.aba }));
  $('#ftipo').onchange = () => rec(); if ($('#fesc')) $('#fesc').onchange = () => rec();
  $$('[data-resolver]').forEach(bt => bt.onclick = async () => {
    await q(sb.from('alertas').update({ resolvido_em: new Date().toISOString(), resolvido_por: st.session.user.id }).eq('id', bt.dataset.resolver));
    rec();
  });
  $$('[data-acao]').forEach(bt => bt.onclick = async () => {
    if (bt.dataset.acao === 'atualizar_senha') return go('#/acesso?esc=' + bt.dataset.esc);
    await pedirExecucao(bt.dataset.esc);
    await q(sb.from('alertas').update({ resolvido_em: new Date().toISOString(), resolvido_por: st.session.user.id }).eq('id', bt.dataset.id));
    rec();
  });
}

// ---------- acesso à Sefaz ----------
async function telaAcesso(params) {
  const [escs, creds, pcs] = await Promise.all([
    q(sb.from('escritorios').select('id,nome').order('nome')),
    q(sb.from('credenciais_sefaz').select('*')),
    carregarPcs(),
  ]);
  const cm = Object.fromEntries(creds.map(c => [c.escritorio_id, c]));
  const selId = params.get('esc') || (eAdmin() ? escs[0]?.id : st.perfil.escritorio_id);
  const es = escs.find(e => e.id === selId); const c = cm[selId];
  await layout('acesso', `
    <div class="top"><div><div class="sub">Login do contador usado pelo robô, um por escritório</div><h1>Acesso à Sefaz-GO</h1></div></div>
    <div class="cols form">
      <section class="card tbl-wrap">${escs.length ? `<table class="tbl"><thead><tr><th>Escritório</th><th>Contador</th><th>CPF</th><th>Situação</th><th>Último teste</th><th>Senha alterada</th></tr></thead><tbody>
        ${escs.map(e => { const x = cm[e.id]; return `<tr class="click" data-href="#/acesso?esc=${e.id}" style="${e.id === selId ? 'background:#F6EFD9' : ''}"><td style="font-weight:600">${h(e.nome)}</td><td>${h(x?.nome_contador || '—')}</td><td>${x ? mascCpf(x.cpf) : '—'}</td>
          <td>${pillSefaz(x?.situacao)}</td><td>${quando(x?.ultimo_teste)}</td><td>${x?.alterada_em ? new Date(x.alterada_em).toLocaleDateString('pt-BR') : '—'}</td></tr>`; }).join('')}
      </tbody></table>` : '<div class="empty">Cadastre um escritório primeiro.</div>'}</section>
      ${es ? `<form class="card pad" id="f" style="display:flex;flex-direction:column;gap:14px">
        <div><div class="sub" style="text-transform:uppercase;letter-spacing:.06em;font-weight:600">Editando</div><h2 style="font-size:18px;margin-top:4px">${h(es.nome)}</h2></div>
        ${c?.situacao === 'recusada' ? `<div class="msg err">A Sefaz recusou a senha ${quando(c.ultimo_teste)}. Se ela mudou, atualize aqui.</div>` : ''}
        <label class="f">Nome do contador<input name="nome" value="${h(c?.nome_contador)}"></label>
        <label class="f">CPF do contador<input name="cpf" required inputmode="numeric" value="${h(c?.cpf)}"></label>
        <label class="f">${c?.senha_secret_id ? 'Nova senha da Sefaz' : 'Senha da Sefaz'}<input name="senha" type="password" autocomplete="new-password" ${c?.senha_secret_id ? 'placeholder="Deixe em branco para manter a atual"' : 'required'}></label>
        <label class="chk"><input type="checkbox" id="ver">Mostrar senha</label>
        <label class="chk"><input type="checkbox" name="rodar" checked>Ao salvar, já rodar os downloads</label>
        <button class="btn p" type="submit">Salvar</button>
        <div class="sub">A senha fica guardada criptografada. Depois de salva, ninguém consegue ver, só trocar.${c?.alterada_em ? `<br>Última alteração: ${new Date(c.alterada_em).toLocaleDateString('pt-BR')}` : ''}</div>
      </form>` : ''}
    </div>
    ${pcs.length ? `<section class="card tbl-wrap"><div class="pad" style="padding-bottom:8px"><h2>Computadores com a extensão</h2><div class="sub" style="margin-top:4px">Aparecem em "Baixar em". Exclua os que não usa mais. Ao remover a extensão do Chrome (versão 3.8.1 ou mais nova), o computador sai daqui sozinho.</div></div>
      <table class="tbl"><thead><tr><th>Computador</th><th>Situação</th><th>Último sinal</th><th>Versão</th><th></th></tr></thead><tbody>
      ${pcs.map(p => `<tr><td style="font-weight:600">${h(p.nome)}${p.id === meuPc() ? ' <span class="sub">(este)</span>' : ''}</td>
        <td>${p.verificacao_desde && pcOnline(p) ? '<span class="pill er">Parado na verificação</span>' : pcOnline(p) ? '<span class="pill ok">Online</span>' : '<span class="pill na">Offline</span>'}</td>
        <td>${quando(p.ultimo_sinal)}</td><td>${h(p.versao || '—')}</td>
        <td style="text-align:right">${eAdmin() ? `<button type="button" class="btn s del-o" data-tirar-pc="${p.id}">Excluir</button>` : ''}</td></tr>`).join('')}
      </tbody></table></section>` : ''}`);
  $$('tr.click').forEach(tr => tr.onclick = () => go(tr.dataset.href));
  $$('[data-tirar-pc]').forEach(bt => bt.onclick = async () => {
    if (await excluirPc(pcs.find(p => p.id === bt.dataset.tirarPc))) telaAcesso(params);
  });
  if (!$('#f')) return;
  $('#ver').onchange = e => { $('[name=senha]').type = e.target.checked ? 'text' : 'password'; };
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await q(sb.rpc('salvar_credencial_sefaz', { p_escritorio: selId, p_cpf: fd.get('cpf').replace(/\D/g, ''), p_senha: fd.get('senha') || null, p_nome_contador: fd.get('nome') || null }));
    await q(sb.from('alertas').update({ resolvido_em: new Date().toISOString(), resolvido_por: st.session.user.id }).eq('escritorio_id', selId).eq('acao', 'atualizar_senha').is('resolvido_em', null));
    if (fd.has('rodar')) await pedirExecucao(selId); else toast('Acesso salvo.');
    telaAcesso(params);
  };
}

// ---------- atualizações da extensão ----------
const REPO = 'kaiosoftnews-007/automacao-de-notas';
async function montarZip(v) {
  const [login] = await q(sb.rpc('extensao_login_ler')) || [];
  if (!login?.senha) throw new Error('configure primeiro o login que vai dentro da extensão');
  const arv = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${encodeURIComponent(v.ref)}?recursive=1`)
    .then(r => r.ok ? r.json() : Promise.reject(new Error('GitHub não respondeu (' + r.status + ')')));
  const arquivos = (arv.tree || []).filter(t => t.type === 'blob' && t.path.startsWith('extensao/') && !/credenciais\.json$/.test(t.path));
  if (!arquivos.length) throw new Error(`versão ${v.versao} não encontrada no GitHub`);
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = new JSZip(), pasta = `extensao-automacao-notas-v${v.versao}/`;
  await Promise.all(arquivos.map(async a => {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(v.ref)}/${a.path}`);
    if (!r.ok) throw new Error('falhou ao baixar ' + a.path);
    zip.file(pasta + a.path.slice('extensao/'.length), await r.arrayBuffer());
  }));
  zip.file(pasta + 'credenciais.json', JSON.stringify({ email: login.email, senha: login.senha }, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `extensao-automacao-notas-v${v.versao}.zip`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}
function pedirLoginExtensao(atual) {
  return new Promise(resolve => {
    const fundo = document.createElement('div'); fundo.className = 'modal-fundo';
    fundo.innerHTML = `<form class="card modal"><h2>Login que vai dentro da extensão</h2>
      <div class="sub">Login de administrador do painel. A extensão entra sozinha com ele. A senha fica guardada criptografada.</div>
      <label class="f">E-mail<input name="email" type="email" required value="${h(atual || st.session.user.email)}"></label>
      <label class="f">Senha<input name="senha" type="password" required autocomplete="current-password"></label>
      <div id="merr" style="color:var(--err);font-size:13px;min-height:16px"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="mcanc">Cancelar</button><button class="btn p">Salvar</button></div></form>`;
    document.body.appendChild(fundo);
    const form = fundo.querySelector('form'); form.senha.focus();
    const fechar = ok => { fundo.remove(); resolve(ok); };
    fundo.querySelector('#mcanc').onclick = () => fechar(false);
    form.onsubmit = async e => {
      e.preventDefault();
      const bt = form.querySelector('.p'); bt.disabled = true; bt.textContent = 'Conferindo…';
      const email = form.email.value.trim(), senha = form.senha.value;
      // Confere o login sem mexer na sessão aberta do painel.
      const teste = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'teste-login-extensao' } });
      const { data, error } = await teste.auth.signInWithPassword({ email, password: senha });
      const papel = data?.user ? (await teste.from('perfis').select('papel').eq('user_id', data.user.id).maybeSingle()).data?.papel : null;
      const erro = error ? 'E-mail ou senha incorretos.' : papel !== 'admin' ? 'Esse login não é administrador do painel.' : '';
      if (erro) { bt.disabled = false; bt.textContent = 'Salvar'; fundo.querySelector('#merr').textContent = erro; return; }
      try { await q(sb.rpc('extensao_login_salvar', { p_email: email, p_senha: senha })); }
      catch (_) { bt.disabled = false; bt.textContent = 'Salvar'; return; }
      fechar(true);
    };
  });
}
const dataBr = d => new Date(d + 'T12:00').toLocaleDateString('pt-BR');
async function telaAtualizacoes() {
  if (!eAdmin()) return go('#/');
  const [vers, pcs, logins] = await Promise.all([
    q(sb.from('extensao_versoes').select('*')),
    carregarPcs(),
    q(sb.from('extensao_login').select('email,alterado_em')),
  ]);
  vers.sort((a, b) => cmpVer(b.versao, a.versao));
  const princ = vers.find(v => v.principal) || vers[0], login = logins[0];
  const atras = pcs.filter(p => desatualizado(p, princ?.versao));
  await layout('atualizacoes', `
    <div class="top"><div><div class="sub">Baixe a extensão do Chrome em qualquer computador</div><h1>Atualizações</h1></div></div>
    ${princ ? `<section class="card pad" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      <div style="width:52px;height:52px;border-radius:10px;background:var(--navy);display:flex;align-items:center;justify-content:center"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg></div>
      <div style="flex:1;min-width:260px"><div class="sub">Versão para instalar</div>
        <div style="font-size:28px;font-weight:700;margin-top:2px">${h(princ.versao)} <span class="pill ok" style="vertical-align:middle;margin-left:6px">Principal</span></div>
        <div class="sub" style="margin-top:4px">Publicada em ${dataBr(princ.publicada_em)} · ${h(princ.descricao || '')}. Já vem com o login do painel.</div></div>
      <button type="button" class="btn p" style="padding:0 22px" data-baixar="${h(princ.versao)}">Baixar extensão (.zip)</button>
    </section>` : '<div class="card empty">Nenhuma versão cadastrada.</div>'}
    <div class="sub" style="margin-top:-8px">Login dentro da extensão: ${login ? `<b>${h(login.email)}</b>` : '<b style="color:var(--err)">não configurado</b>'} · <a href="#" id="trocar-login">${login ? 'Alterar' : 'Configurar'}</a></div>
    ${atras.length ? `<div class="card" style="background:var(--warn-bg);border-color:#E9C46A;padding:14px 18px;color:var(--warn);font-size:14px"><b>${atras.map(p => `${h(p.nome)} (${h(p.versao || 'sem versão')})`).join(', ')} ${atras.length > 1 ? 'estão desatualizados' : 'está desatualizado'}.</b> Baixe a ${h(princ.versao)} e siga os passos para atualizar.</div>` : ''}
    <div class="cols">
      <section class="card tbl-wrap"><div class="pad" style="padding-bottom:8px"><h2>Computadores com a extensão</h2><div class="sub" style="margin-top:4px">Versão que cada computador informou no último sinal. Ao remover a extensão do Chrome (3.8.1 ou mais nova), ele sai daqui sozinho.</div></div>
        ${pcs.length ? `<table class="tbl"><thead><tr><th>Computador</th><th>Situação</th><th>Último sinal</th><th>Versão</th><th class="c">Atualizada?</th><th></th></tr></thead><tbody>
        ${pcs.map(p => `<tr><td style="font-weight:600">${h(p.nome)}${p.id === meuPc() ? ' <span class="sub">(este)</span>' : ''}</td>
          <td>${p.verificacao_desde && pcOnline(p) ? '<span class="pill er">Parado na verificação</span>' : pcOnline(p) ? '<span class="pill ok">Online</span>' : '<span class="pill na">Offline</span>'}</td>
          <td>${quando(p.ultimo_sinal)}</td><td>${h(p.versao || '—')}</td>
          <td class="c">${desatualizado(p, princ?.versao) ? '<span class="pill warn">Desatualizado</span>' : '<span class="pill ok">Em dia</span>'}</td>
          <td style="text-align:right"><button type="button" class="btn s del-o" data-tirar-pc="${p.id}">Excluir</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Nenhum computador com nome ainda. Dê um nome no ícone da extensão.</div>'}</section>
      <section class="card pad"><h2>Como instalar ou atualizar</h2>
        <ol style="font-size:14px;color:var(--ink2);padding-left:20px;margin:12px 0 0;line-height:1.7">
          <li>Baixe o zip e extraia numa pasta fixa.<div class="mono" style="margin:6px 0">Documentos\\extensao-sefaz</div></li>
          <li>Abra <b>chrome://extensions</b> e ligue o <b>Modo do desenvolvedor</b>.</li>
          <li><b>Primeira vez:</b> Carregar sem compactação → escolha a pasta.</li>
          <li><b>Atualizar:</b> substitua os arquivos da pasta e clique em <b>recarregar</b> (↻) na extensão.</li>
          <li>No ícone da extensão, dê um nome ao computador (ex.: PC-CASA).</li></ol></section>
    </div>
    <section class="card tbl-wrap"><div class="pad" style="padding-bottom:8px"><h2>Histórico de versões</h2><div class="sub" style="margin-top:4px">A versão principal não pode ser excluída; torne outra principal antes.</div></div>
      <table class="tbl"><thead><tr><th>Versão</th><th>Data</th><th>O que mudou</th><th></th></tr></thead><tbody>
      ${vers.map(v => `<tr><td style="font-weight:600">${h(v.versao)}${v.principal ? ' <span class="pill ok">Principal</span>' : ''}</td><td>${dataBr(v.publicada_em)}</td><td>${h(v.descricao || '')}</td>
        <td style="text-align:right;white-space:nowrap"><button type="button" class="btn s o" data-baixar="${h(v.versao)}">Baixar</button>
        ${v.principal ? '' : ` <button type="button" class="btn s" data-principal="${h(v.versao)}">Tornar principal</button> <button type="button" class="btn s del-o" data-excluir-ver="${h(v.versao)}">Excluir</button>`}</td></tr>`).join('')}
      </tbody></table></section>`);
  $('#trocar-login').onclick = async e => { e.preventDefault(); if (await pedirLoginExtensao(login?.email)) { toast('Login da extensão salvo.'); telaAtualizacoes(); } };
  $$('[data-baixar]').forEach(bt => bt.onclick = async () => {
    const v = vers.find(x => x.versao === bt.dataset.baixar);
    if (!login && !await pedirLoginExtensao()) return;
    const txt = bt.textContent; bt.disabled = true; bt.textContent = 'Montando…';
    try { await montarZip(v); toast(`Extensão ${v.versao} baixada.`); if (!login) telaAtualizacoes(); }
    catch (er) { toast('Não foi possível baixar: ' + er.message); }
    finally { bt.disabled = false; bt.textContent = txt; }
  });
  $$('[data-principal]').forEach(bt => bt.onclick = async () => {
    await q(sb.rpc('extensao_tornar_principal', { p_versao: bt.dataset.principal }));
    toast(`${bt.dataset.principal} agora é a versão principal.`); carregarMenu(true); telaAtualizacoes();
  });
  $$('[data-excluir-ver]').forEach(bt => bt.onclick = async () => {
    const ver = bt.dataset.excluirVer;
    if (!await confirmar(`Excluir a versão ${ver}?`, 'Ela sai do histórico e não aparece mais para baixar. Os computadores que já têm ela instalada continuam funcionando.', 'Excluir versão')) return;
    await q(sb.from('extensao_versoes').delete().eq('versao', ver));
    toast(`Versão ${ver} excluída.`); telaAtualizacoes();
  });
  $$('[data-tirar-pc]').forEach(bt => bt.onclick = async () => {
    if (await excluirPc(pcs.find(p => p.id === bt.dataset.tirarPc))) telaAtualizacoes();
  });
}

// Página que o Chrome abre quando a extensão é removida: tira o computador da lista (não precisa de login).
async function telaRemovida(params) {
  root.innerHTML = '<div class="login"><div class="card"><div class="sub">Tirando este computador da lista…</div></div></div>';
  const { data: nome, error } = await sb.rpc('extensao_removida', { p_pc: params.get('pc'), p_chave: params.get('k') });
  const card = root.querySelector('.login .card');
  card.innerHTML = error
    ? `<h1 style="font-size:20px">Não foi possível tirar este computador da lista</h1><p class="sub">Exclua pelo painel, em Atualizações.</p>`
    : `<h1 style="font-size:20px">Extensão removida</h1><p class="sub">${nome ? `<b>${h(nome)}</b> saiu da lista de computadores do painel.` : 'Este computador já não estava na lista do painel.'} Pode fechar esta aba.</p>`;
}

// ---------- rotina ----------
async function telaRotina(id) {
  const [es, rot, exes, pcs] = await Promise.all([
    q(sb.from('escritorios').select('id,nome,pc_padrao').eq('id', id).maybeSingle()),
    q(sb.from('rotinas').select('*').eq('escritorio_id', id).maybeSingle()),
    q(sb.from('execucoes').select('*').eq('escritorio_id', id).order('solicitada_em', { ascending: false }).limit(1)),
    carregarPcs(),
  ]);
  if (!es) return naoEncontrado('Escritório não encontrado', 'Abra a rotina pela página do escritório.');
  const r = rot || { dias_semana: [1, 2, 3, 4, 5], horario: '06:00', periodo: 'mes_anterior', pasta_destino: 'C:\\Notas', tentativas: 3, avisar_email: true, resumo_diario: true, avisar_whatsapp: false, ativa: true };
  const ult = exes[0];
  const dls = ult ? await q(sb.from('downloads').select('*, empresas(razao_social,ie)').eq('execucao_id', ult.id).order('empresa_id')) : [];
  const nomePc = pcs.find(p => p.id === ult?.pc_id)?.nome;
  const EXE = { pendente: ['pe', 'Aguardando robô'], aguardando_pc: ['pe', 'Aguardando o ' + (nomePc || 'computador escolhido')], rodando: ['pe', nomePc ? 'Rodando no ' + nomePc : 'Rodando'], concluida: ['ok', 'Concluída'], com_erros: ['pe', 'Concluída com erros'], falhou: ['er', 'Falhou'] };
  await layout('rotina', `
    <div class="top"><div><div class="sub"><a href="#/escritorio/${id}">${h(es.nome)}</a></div><h1>Rotina automática</h1></div><div class="filters">${seletorPc(es, pcs)}</div></div>
    <form id="f" class="cols" style="grid-template-columns:1fr 1fr">
      <section class="card pad" style="display:flex;flex-direction:column;gap:16px">
        <h2>Quando rodar</h2>
        <label class="chk"><input type="checkbox" name="ativa" ${r.ativa ? 'checked' : ''}>Rotina ligada</label>
        <div class="f">Dias da semana<div style="display:flex;gap:6px;flex-wrap:wrap">${DIAS.map((d, i) => `<button type="button" class="day ${r.dias_semana.includes(i) ? 'on' : ''}" data-dia="${i}" aria-pressed="${r.dias_semana.includes(i)}">${d}</button>`).join('')}</div></div>
        <div class="g2"><label class="f">Horário<input type="time" name="horario" value="${h(String(r.horario).slice(0, 5))}"></label>
          <label class="f">Período das notas<select name="periodo"><option value="mes_anterior">Mês anterior</option><option value="mes_atual" ${r.periodo === 'mes_atual' ? 'selected' : ''}>Mês atual</option></select></label></div>
        <label class="f">Tentativas quando der erro<select name="tentativas">${[1, 2, 3, 5].map(x => `<option ${x === r.tentativas ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      </section>
      <section class="card pad" style="display:flex;flex-direction:column;gap:14px">
        <h2>Onde salvar e quem avisar</h2>
        <label class="f">Pasta mãe (onde ficam as pastas das empresas)<input name="pasta_destino" value="${h(r.pasta_destino)}" placeholder="C:\\Clientes"></label>
        <div class="sub">Para cada empresa: usa a pasta do cadastro dela; sem pasta no cadastro, procura aqui dentro uma pasta com o código ou o nome da empresa e, se não achar, cria "código - nome". Dentro, cria a pasta do mês (ex.: 102026) com Entrada_102026.zip e Saida_102026.zip.</div>
        <label class="chk"><input type="checkbox" name="avisar_email" ${r.avisar_email ? 'checked' : ''}>Avisar por e-mail quando der erro</label>
        <label class="chk"><input type="checkbox" name="resumo_diario" ${r.resumo_diario ? 'checked' : ''}>Resumo diário: empresa, notas de entrada e de saída</label>
        <label class="chk"><input type="checkbox" name="avisar_whatsapp" ${r.avisar_whatsapp ? 'checked' : ''}>Avisar por WhatsApp</label>
        <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="agora">Rodar agora</button><button class="btn p" type="submit">Salvar rotina</button></div>
      </section>
    </form>
    <section class="card tbl-wrap">
      <div class="pad" style="padding-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h2>Última execução</h2>${ult ? `<span class="pill ${EXE[ult.status][0]}">${EXE[ult.status][1]}</span><span class="sub">${ult.origem === 'manual' ? 'Pedida manualmente' : 'Agendada'} · ${quando(ult.solicitada_em)}</span>` : ''}</div>
      ${dls.length ? `<table class="tbl"><thead><tr><th>Empresa</th><th>IE</th><th>Tipo</th><th class="c">Notas</th><th>Situação</th><th>Detalhe</th></tr></thead><tbody>
        ${dls.map(d => `<tr><td style="font-weight:600">${h(d.empresas?.razao_social)}</td><td>${h(d.empresas?.ie)}</td><td>${d.tipo === 'entrada' ? 'Entrada' : 'Saída'}</td><td class="c">${d.qtd_notas ?? '—'}</td><td><span class="pill ${ST_DL[d.status][0]}">${ST_DL[d.status][1]}</span></td><td class="sub">${h(d.mensagem || d.arquivo || '')}</td></tr>`).join('')}
      </tbody></table>` : `<div class="empty">${!ult ? 'Nenhuma execução ainda.' : ult.status === 'aguardando_pc' ? `O ${h(nomePc || 'computador escolhido')} pega o pedido em até 1 minuto e baixa em segundo plano. As notas ficam salvas nele.` : 'Aguardando o robô começar.'}</div>`}
    </section>`);
  $$('[data-dia]').forEach(bt => bt.onclick = () => { bt.classList.toggle('on'); bt.setAttribute('aria-pressed', bt.classList.contains('on')); });
  ligarSeletorPc(id);
  $('#agora').onclick = async () => { await pedirExecucao(id); telaRotina(id); };
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await q(sb.from('rotinas').upsert({
      escritorio_id: id, ativa: fd.has('ativa'), dias_semana: $$('[data-dia].on').map(b => +b.dataset.dia),
      horario: fd.get('horario'), periodo: fd.get('periodo'), tentativas: +fd.get('tentativas'), pasta_destino: fd.get('pasta_destino'),
      avisar_email: fd.has('avisar_email'), resumo_diario: fd.has('resumo_diario'), avisar_whatsapp: fd.has('avisar_whatsapp'),
      atualizada_em: new Date().toISOString(),
    }));
    toast('Rotina salva.');
  };
}

function naoEncontrado(titulo, texto) {
  return layout('', `<div class="card pad" style="max-width:520px;display:flex;flex-direction:column;gap:12px"><h2>${h(titulo)}</h2><div class="sub">${h(texto)}</div>
    <a class="btn p" href="${eAdmin() ? '#/escritorios' : '#/'}" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none">Voltar</a></div>`);
}

// ---------- roteador ----------
async function rota() {
  const [rp, rq] = (location.hash.slice(1) || '/').split('?');
  if (rp === '/removida') { if (!st.removidaFeita) { st.removidaFeita = true; await telaRemovida(new URLSearchParams(rq || '')); } return; }
  if (!st.session) return telaLogin();
  if (!st.perfil) {
    st.perfil = await q(sb.from('perfis').select('*').eq('user_id', st.session.user.id).maybeSingle());
    if (!st.perfil) { root.innerHTML = '<div class="login"><div class="card"><h1 style="font-size:20px">Perfil não encontrado</h1><p class="sub">Peça ao administrador para liberar seu acesso.</p></div></div>'; return; }
  }
  if (!eAdmin() && !st.perfil.escritorio_id) {
    root.innerHTML = `<div class="login"><div class="card"><h1 style="font-size:20px">Aguardando liberação</h1><p class="sub">Seu login foi criado. O administrador precisa ligar você ao seu escritório.</p><button class="btn" id="sair">Sair</button></div></div>`;
    $('#sair').onclick = () => sb.auth.signOut(); return;
  }
  carregarMenu();
  mostrarCarregando();
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const p = path.split('/').filter(Boolean);
  try {
    if (!p.length) return await telaPainel();
    if (p[0] === 'entregas') return await telaEntregas();
    if (p[0] === 'escritorios') return await telaEscritorios();
    if (p[0] === 'escritorio' && p[1]) return await telaEscritorio(p[1]);
    if (p[0] === 'empresa' && p[1]) return await telaEmpresa(p[1], params);
    if (p[0] === 'alertas') return await telaAlertas();
    if (p[0] === 'acesso') return await telaAcesso(params);
    if (p[0] === 'atualizacoes') return await telaAtualizacoes();
    if (p[0] === 'rotina' && p[1]) return await telaRotina(p[1]);
    go('#/');
  } catch (e) {
    console.error(e);
    try { await naoEncontrado('Não foi possível abrir esta tela', 'Erro: ' + (e?.message || e) + ' · tela: ' + location.hash); } catch (_) {}
  }
}

window.addEventListener('hashchange', rota);
sb.auth.onAuthStateChange((evento, session) => {
  st.session = session;
  if (!session) st.perfil = null;
  if (evento === 'PASSWORD_RECOVERY') return setTimeout(telaNovaSenha, 0);
  // setTimeout: não chamar o Supabase de dentro do próprio callback (evita travar)
  if (st.reautenticando && evento === 'SIGNED_IN') return; // conferência de senha na exclusão: não recarrega a tela
  if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(evento)) setTimeout(rota, 0);
});
