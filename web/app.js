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
const ST_ENT = { ok: ['ok', 'OK'], pendente: ['pe', 'Pend.'], atrasado: ['er', 'Atraso'], na: ['na', '—'], semmov: ['sm', 'Sem mov.'] };
const CICLO = { pendente: 'ok', ok: 'na', na: 'atrasado', atrasado: 'pendente', semmov: 'ok' };
const FEITO = s => s === 'ok' || s === 'semmov';   // conta como entregue
const ST_DL = {
  fila: ['pe', 'Na fila'], processando: ['pe', 'Baixando'], concluido: ['ok', 'OK'],
  sem_notas: ['pe', 'Sem notas'], erro: ['er', 'Erro'],
};
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#142744" stroke-width="2" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6"/><path d="M9 15l3 3 3-3"/></svg>';

// ---------- estado ----------
const st = { session: null, perfil: null, comp: compPadrao(), vez: 0, cache: new Map(), fEsc: {}, reexibir: null };
const selecao = {};   // empresas marcadas em cada escritório (IEs), para o botão Baixar selecionadas

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
// O Supabase devolve no máximo 1.000 linhas por consulta. Aqui busca de 1.000 em 1.000 até acabar,
// para os números do painel não ficarem errados (sem aviso) quando houver mais empresas e downloads.
// "montar" devolve a consulta nova a cada página; ela precisa ter uma ordem fixa (por isso o .order('id')).
async function todos(montar) {
  const tudo = [];
  for (let de = 0; ; de += 1000) {
    const parte = await q(montar().range(de, de + 999));
    tudo.push(...parte);
    if (parte.length < 1000) return tudo;
  }
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
      limparCache(); toast('Escritório atualizado.'); fechar(true);
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
      <div class="sub" id="merr" style="color:var(--err-t)"></div>
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
// Menu, computadores, alertas e o download que está rodando. Fica guardado por 60 s; a atualização automática força.
function carregarMenu(forcar = false) {
  if (!forcar && st.menuP && Date.now() - st.menuEm < 60000) return st.menuP;
  st.menuEm = Date.now();
  st.menuP = (async () => {
    const desde = new Date(Date.now() - 12 * 3600e3).toISOString();
    const [al, pcsR, princR, exeR] = await Promise.all([
      sb.from('alertas').select('id', { count: 'exact', head: true }).is('resolvido_em', null),
      sb.from('computadores').select('*').order('nome'),
      sb.from('extensao_versoes').select('versao').eq('principal', true).maybeSingle(),
      sb.from('execucoes').select('id,escritorio_id,status,pc_id,ie,competencia,solicitada_em,iniciada_em,escritorios(nome)')
        .in('status', ['rodando', 'aguardando_pc']).gte('solicitada_em', desde).order('solicitada_em', { ascending: false }).limit(6),
    ]);
    const exes = exeR?.data || [], rod = exes.find(x => x.status === 'rodando');
    let vivo = null;
    if (rod) {   // andamento do download que está rodando: empresas terminadas / empresas do pedido
      const [dl, tot] = await Promise.all([
        sb.from('downloads').select('empresa_id,status,mensagem,atualizado_em').eq('execucao_id', rod.id).order('atualizado_em').limit(1000),
        rod.ie ? null : sb.from('empresas').select('id', { count: 'exact', head: true }).eq('escritorio_id', rod.escritorio_id).eq('ativa', true).not('ie', 'is', null),
      ]);
      const porEmp = {};
      for (const d of dl?.data || []) (porEmp[d.empresa_id] = porEmp[d.empresa_id] || []).push(d);
      const feitas = Object.values(porEmp).filter(l => l.every(d => !['fila', 'processando'].includes(d.status))).length;
      const total = rod.ie ? rod.ie.split(',').filter(Boolean).length : (tot?.count || 0);
      vivo = { exe: rod, feitas, total: Math.max(total, feitas), ult: (dl?.data || []).at(-1) || null };
    }
    return { alertas: al?.count || 0, pcs: pcsR?.data || [], principal: princR?.data?.versao || null, exes, vivo };
  })();
  return st.menuP;
}

// Troca de tela instantânea: mantém o menu e mostra "carregando" enquanto busca os dados
function mostrarCarregando() {
  const m = root.querySelector('main');
  if (m) m.innerHTML = '<div class="esq"><i></i><i></i><i></i><i></i></div><div class="empty" style="padding:40px">Carregando…</div>';
  const side = root.querySelector('#side'); if (side) side.classList.remove('open');
}

const ic = d => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ICO = {
  painel: 'M3 12l9-8 9 8M5 10v10h14V10', entregas: 'M5 12l4 4 10-10', escritorios: 'M4 21V5h10v16M14 9h6v12M8 9h2M8 13h2M8 17h2',
  alertas: 'M12 3l9 16H3zM12 10v4M12 17h.01', acesso: 'M7 11V7a5 5 0 0110 0v4M5 11h14v10H5z', atualizacoes: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  rotina: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
};
const haQuanto = t => {
  if (!t) return '—';
  const m = Math.max(0, Math.round((Date.now() - new Date(t)) / 60000));
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
};
// Cada tela pega um número ao começar; se outra tela começou depois, a antiga não desenha por cima.
const CANCELADA = 'tela-cancelada';
window.addEventListener('unhandledrejection', e => { if (e.reason === CANCELADA) e.preventDefault(); });

async function layout(vez, ativo, conteudo) {
  const m = await carregarMenu();
  if (vez !== st.vez) throw CANCELADA;
  const pcs = m.pcs;
  const atrasados = m.principal ? pcs.filter(p => desatualizado(p, m.principal)).length : 0;
  const parados = pcs.filter(p => p.verificacao_desde && pcOnline(p));
  const itens = eAdmin()
    ? [['#/', 'Painel geral', 'painel'], ['#/entregas', 'Visão de entregas', 'entregas'], ['#/escritorios', 'Escritórios', 'escritorios'],
       ['#/alertas', 'Alertas', 'alertas'], ['#/acesso', 'Acesso à Sefaz', 'acesso'], ['#/atualizacoes', 'Atualizações', 'atualizacoes']]
    : [['#/escritorio/' + st.perfil.escritorio_id, 'Meu escritório', 'escritorios'], ['#/entregas', 'Entregas', 'entregas'],
       ['#/alertas', 'Alertas', 'alertas'], ['#/acesso', 'Acesso à Sefaz', 'acesso'], ['#/rotina/' + st.perfil.escritorio_id, 'Rotina automática', 'rotina']];
  st.itensMenu = itens;
  const estadoPc = p => p.verificacao_desde && pcOnline(p) ? 'verificação' : m.exes.some(x => x.status === 'rodando' && x.pc_id === p.id) ? 'baixando' : pcOnline(p) ? 'livre' : haQuanto(p.ultimo_sinal);
  const lado = `
      <div class="brand"><i>${ICON}</i>Automação de Notas</div>
      <nav class="nav">${itens.map(([href, label, k]) =>
        `<a href="${href}" class="${k === ativo ? 'on' : ''}">${ic(ICO[k])}<span>${label}</span>${k === 'alertas' && m.alertas ? ` <span class="badge">${m.alertas}</span>` : ''}${k === 'atualizacoes' && atrasados ? ` <span class="badge" style="background:var(--gold)">${atrasados}</span>` : ''}</a>`).join('')}</nav>
      <div class="me">
        ${pcs.length ? `<div class="me-t">Computadores</div><div class="pcs">${pcs.map(p => `<div title="Último sinal: ${h(quando(p.ultimo_sinal))}"><span class="dot ${pcOnline(p) ? 'on' : ''}"></span>${h(p.nome)}<small>${estadoPc(p)}</small></div>`).join('')}</div>` : ''}
        <div ${pcs.length ? 'style="border-top:1px solid #34507E;padding-top:8px"' : ''}>${h(st.perfil.nome || st.perfil.email)}</div>
        <button type="button" id="sair">Sair</button>
      </div>`;
  const v = m.vivo, parado = v?.ult && Date.now() - new Date(v.ult.atualizado_em) > 15 * 60000;
  const fila = m.exes.filter(x => x.status === 'aguardando_pc');
  const nomePc = id => pcs.find(p => p.id === id)?.nome;
  const faixaVivo = v ? `<div class="card run"><div class="spin"></div><div style="min-width:0">
        <div class="t">Baixando agora · ${h(v.exe.escritorios?.nome || '')}${nomePc(v.exe.pc_id) ? ' · ' + h(nomePc(v.exe.pc_id)) : ''}${v.exe.competencia ? ' · ' + compNome(v.exe.competencia) : ''}</div>
        <div class="d">${v.total ? `${v.feitas} de ${v.total} ${v.total === 1 ? 'empresa terminada' : 'empresas terminadas'}` : 'Começando…'}${v.ult ? ` · última novidade ${haQuanto(v.ult.atualizado_em)}${v.ult.mensagem ? ': ' + h(v.ult.mensagem) : ''}` : ''}${parado ? ' · <b>sem novidade há mais de 15 min: confira o computador</b>' : ''}</div>
        <div class="pb"><span style="width:${v.total ? Math.round(v.feitas / v.total * 100) : 3}%"></span></div></div>
        <a class="btn s lk" href="#/rotina/${v.exe.escritorio_id}">Ver detalhes</a></div>` : '';
  const faixaFila = fila.length ? `<div class="sub">Na fila: ${fila.map(x => `${h(x.escritorios?.nome || '')} aguardando ${h(nomePc(x.pc_id) || 'o computador')}`).join(' · ')}</div>` : '';
  const topo = `<div class="topbar">
        <button type="button" class="btn menu-btn" id="menu" aria-label="Abrir menu">☰</button>
        <button type="button" class="busca" id="abrirBusca" title="Buscar em todo o painel (Ctrl K)">${ic('M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z')}<span>Buscar empresa, CNPJ, IE, escritório ou tela…</span><kbd>Ctrl K</kbd></button>
        ${st.reexibir ? `<button type="button" class="vivo" id="vivo" title="Esta tela se atualiza sozinha a cada 30 segundos. Clique para atualizar agora."><i></i><span>Ao vivo · ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></button>` : ''}
        <button type="button" class="ico" id="tema" title="Modo claro / escuro" aria-label="Modo claro ou escuro">${document.documentElement.dataset.tema === 'escuro' ? '☀' : '☾'}</button>
        <button type="button" class="ico" id="ajuda" title="Como usar o painel" aria-label="Ajuda">?</button>
      </div>`;
  if (!root.querySelector('.app')) root.innerHTML = '<div class="app"><aside class="side" id="side"></aside><main></main></div>';
  $('#side').innerHTML = lado;
  root.querySelector('main').innerHTML = `${topo}
      ${parados.map(p => `<div class="card faixa-err"><b>${h(p.nome)} parou na verificação "Confirme que é humano".</b> Entre por acesso remoto nele e clique na caixinha da aba da Sefaz; o download continua sozinho.</div>`).join('')}
      ${faixaVivo}${faixaFila}
      ${conteudo}`;
  $('#sair').onclick = async () => { await sb.auth.signOut(); };
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  $('#abrirBusca').onclick = abrirBusca;
  $('#ajuda').onclick = abrirAjuda;
  $('#tema').onclick = () => {
    const t = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
    document.documentElement.dataset.tema = t; gravarLocal('automacao-tema', t); $('#tema').textContent = t === 'escuro' ? '☀' : '☾';
  };
  if ($('#vivo')) $('#vivo').onclick = () => atualizarSozinho(true);
  ligarOrdenacao(); animarNumeros();
  return true;
}

// ---------- atualização automática (sem F5) ----------
// Só nas telas de acompanhamento (painel, escritório, entregas, alertas). Não mexe na tela enquanto
// a pessoa digita, escolhe numa lista ou está com uma janela aberta.
async function atualizarSozinho(forcar = false) {
  if (!st.reexibir || !st.session) return;
  const foco = document.activeElement?.tagName;
  if (!forcar && (document.hidden || document.querySelector('.modal-fundo') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(foco) || root.querySelector('details[open]'))) return;
  limparCache(); carregarMenu(true);
  st.quieto = !forcar;
  try { await st.reexibir(); } catch (e) { if (e !== CANCELADA) console.error(e); } finally { st.quieto = false; }
}
setInterval(atualizarSozinho, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - (st.menuEm || 0) > 30000) atualizarSozinho(); });

// ---------- busca rápida (Ctrl K) ----------
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function carregarIndice() {
  if (st.indice && Date.now() - st.indiceEm < 5 * 60000) return st.indice;
  st.indiceEm = Date.now();
  st.indice = Promise.all([
    todos(() => sb.from('empresas').select('id,razao_social,cnpj,ie,codigo,escritorio_id').eq('ativa', true).order('id')),
    q(sb.from('escritorios').select('id,nome').order('nome')),
  ]).then(([emps, escs]) => {
    const nome = Object.fromEntries(escs.map(e => [e.id, e.nome]));
    return { escs, emps: emps.map(e => ({ ...e, esc: nome[e.escritorio_id] || '', t: semAcento([e.razao_social, e.codigo, e.ie, e.cnpj].join(' ')), dig: [e.ie, e.cnpj].map(x => String(x || '').replace(/\D/g, '')).join(' ') })) };
  });
  st.indice.catch(() => { st.indice = null; });
  return st.indice;
}
function abrirBusca() {
  if (document.querySelector('.modal-fundo')) return;
  const fundo = document.createElement('div'); fundo.className = 'modal-fundo alto';
  fundo.innerHTML = `<div class="card pal" role="dialog" aria-modal="true" aria-label="Busca rápida">
    <input id="palq" type="text" placeholder="Digite o nome, código, CNPJ ou IE da empresa, um escritório ou uma tela" autocomplete="off" spellcheck="false">
    <div id="pall"></div><div class="pal-pe">↑ ↓ escolher · Enter abrir · Esc fechar</div></div>`;
  document.body.appendChild(fundo);
  const inp = fundo.querySelector('#palq'), lista = fundo.querySelector('#pall');
  let itens = [], pos = 0, idx = null;
  const fechar = () => { fundo.remove(); };
  const desenhar = () => {
    lista.innerHTML = itens.length ? itens.map((it, i) => `<button type="button" class="it ${i === pos ? 'on' : ''}" data-i="${i}"><b>${it.ico}</b><span>${h(it.nome)}</span><small>${h(it.info || '')}</small></button>`).join('')
      : `<div class="empty" style="padding:20px">${idx ? 'Nada encontrado.' : 'Carregando empresas…'}</div>`;
    lista.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const buscar = () => {
    const t = semAcento(inp.value.trim()), dig = t.replace(/\D/g, '');
    const telas = (st.itensMenu || []).map(([href, nome]) => ({ ico: '▸', nome: 'Ir para ' + nome, info: 'tela', ir: href }));
    itens = [];
    if (!t) itens = telas;
    else if (idx) {
      const emps = idx.emps.filter(e => e.t.includes(t) || (dig.length >= 3 && e.dig.includes(dig))).slice(0, 8);
      itens.push(...emps.map(e => ({ ico: '🏢', nome: e.razao_social, info: [e.esc, e.ie ? 'IE ' + e.ie : ''].filter(Boolean).join(' · '), ir: '#/empresa/' + e.id })));
      if (emps.length === 1 && emps[0].ie) itens.push({ ico: '▶', nome: 'Baixar as notas de ' + emps[0].razao_social, info: compNome(st.comp), fazer: () => pedirExecucao(emps[0].escritorio_id, emps[0].ie) });
      if (eAdmin()) itens.push(...idx.escs.filter(e => semAcento(e.nome).includes(t)).slice(0, 4).map(e => ({ ico: '🗂', nome: e.nome, info: 'escritório', ir: '#/escritorio/' + e.id })));
      itens.push(...telas.filter(x => semAcento(x.nome).includes(t)));
    }
    pos = 0; desenhar();
  };
  const escolher = i => { const it = itens[i]; if (!it) return; fechar(); if (it.fazer) it.fazer(); else go(it.ir); };
  inp.oninput = buscar;
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); pos = Math.min(pos + 1, itens.length - 1); desenhar(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); pos = Math.max(pos - 1, 0); desenhar(); }
    else if (e.key === 'Enter') { e.preventDefault(); escolher(pos); }
    else if (e.key === 'Escape') fechar();
  };
  lista.onclick = e => { const b = e.target.closest('[data-i]'); if (b) escolher(+b.dataset.i); };
  fundo.onclick = e => { if (e.target === fundo) fechar(); };
  buscar(); inp.focus();
  carregarIndice().then(x => { idx = x; if (fundo.isConnected) buscar(); }).catch(() => {});
}
document.addEventListener('keydown', e => {
  if (!st.perfil || !root.querySelector('.app')) return;
  const digitando = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBusca(); }
  else if (e.key === '/' && !digitando && !document.querySelector('.modal-fundo')) { e.preventDefault(); abrirBusca(); }
});

function abrirAjuda() {
  if (document.querySelector('.modal-fundo')) return;
  const fundo = document.createElement('div'); fundo.className = 'modal-fundo';
  fundo.innerHTML = `<div class="card modal" role="dialog" aria-modal="true" style="max-width:560px"><h2 style="font-size:18px">Como usar o painel</h2>
    <div class="ajuda">
      <p><b>Buscar:</b> aperte <kbd>Ctrl</kbd> + <kbd>K</kbd> (ou <kbd>/</kbd>) em qualquer tela e digite o nome, o código, o CNPJ ou a IE da empresa.</p>
      <p><b>Ao vivo:</b> Painel geral, escritório, entregas e alertas se atualizam sozinhos a cada 30 segundos. Clique em "Ao vivo" para atualizar na hora.</p>
      <p><b>Cartões:</b> clique num cartão de número para abrir a lista só com aquelas empresas.</p>
      <p><b>Cores do download:</b> <span class="pill ok">OK</span> ZIP na pasta · <span class="pill pe">Na fila</span> pedido feito, esperando · <span class="pill pe">Atenção</span> um lado veio sem notas · <span class="pill er">Erro</span> precisa refazer · <span class="pill na">Não baixado</span> ainda não pedido.</p>
      <p><b>Entregas:</b> clique no quadradinho da obrigação para trocar: Pendente → OK → N/A → Atraso. Impt. NFs se marca sozinha pelo download.</p>
      <p><b>Várias empresas:</b> marque as caixinhas na tela do escritório para baixar, marcar entrega ou exportar só as escolhidas.</p>
      <p><b>Tabelas:</b> clique no título de uma coluna para ordenar; clique de novo para inverter.</p>
    </div>
    <div style="display:flex;justify-content:flex-end"><button type="button" class="btn p" id="mok">Entendi</button></div></div>`;
  document.body.appendChild(fundo);
  fundo.querySelector('#mok').onclick = () => fundo.remove();
  fundo.onclick = e => { if (e.target === fundo) fundo.remove(); };
  fundo.querySelector('#mok').focus();
}

// Botões de entrega (quadradinhos): clicar troca o status. Vale na Visão de entregas e na tela do escritório.
function ligarEntregas(b, depois) {
  $$('button.s[data-ob]').forEach(bt => bt.onclick = async ev => {
    ev.stopPropagation();
    const novo = CICLO[bt.dataset.st];
    await q(sb.from('entregas').upsert({ empresa_id: bt.dataset.emp, competencia: st.comp, obrigacao: bt.dataset.ob, status: novo, atualizado_por: st.session.user.id, atualizado_em: new Date().toISOString() }));
    bt.dataset.st = novo; bt.className = 's ' + ST_ENT[novo][0];
    if (bt.dataset.curto) bt.title = `${bt.dataset.curto}: ${ST_ENT[novo][1]} (clique para mudar)`; else bt.textContent = ST_ENT[novo][1];
    b.entMap[bt.dataset.emp + bt.dataset.ob] = novo;
    if (depois) depois(bt);
  });
}
// Botões dos alertas: ação (refazer, atualizar senha) e Resolvido. Vale no Painel geral e na tela de Alertas.
function ligarAlertas(depois) {
  $$('[data-resolver]').forEach(bt => bt.onclick = async () => {
    await q(sb.from('alertas').update({ resolvido_em: new Date().toISOString(), resolvido_por: st.session.user.id }).eq('id', bt.dataset.resolver));
    carregarMenu(true); depois();
  });
  $$('[data-acao]').forEach(bt => bt.onclick = async () => {
    if (bt.dataset.acao === 'atualizar_senha') return go('#/acesso?esc=' + bt.dataset.esc + '&cont=padrao');
    await pedirExecucao(bt.dataset.esc);
    await q(sb.from('alertas').update({ resolvido_em: new Date().toISOString(), resolvido_por: st.session.user.id }).eq('id', bt.dataset.id));
    carregarMenu(true); depois();
  });
}
const ACAO_ALERTA = { atualizar_senha: 'Atualizar senha', tentar_de_novo: 'Tentar de novo', baixar_novas: 'Baixar as novas' };

// ---------- ordenar tabelas clicando no título da coluna ----------
// Vale para toda tabela do painel (menos as agrupadas, como a Visão de entregas). Clicar de novo inverte.
// A escolha fica guardada por tela, então continua igual ao trocar a competência ou voltar à tela.
const ORD_DATA = /^(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{2}):(\d{2}))?/;
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
function valorOrdem(td) {
  if (!td) return null;
  const t = (td.dataset.ord ?? td.innerText).trim();
  if (!t || t === '—' || t === '-') return null;
  if (td.dataset.ord != null && !isNaN(+t)) return +t;
  let m = t.match(ORD_DATA);
  if (m) return new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
  m = t.match(/^([a-zç]{3})\/(\d{4})$/i);
  if (m && MESES.includes(m[1].toLowerCase())) return +m[2] * 12 + MESES.indexOf(m[1].toLowerCase());
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(t) || /^-?\d+(,\d+)?$/.test(t)) return +t.replace(/\./g, '').replace(',', '.');
  return t;
}
function ordenarTabela(tab, col, dir) {
  const corpo = tab.tBodies[0]; if (!corpo) return;
  [...corpo.rows].sort((a, b) => {
    const x = valorOrdem(a.cells[col]), y = valorOrdem(b.cells[col]);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;   // vazio sempre no fim
    const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true, sensitivity: 'base' });
    return dir * r;
  }).forEach(tr => corpo.appendChild(tr));
  [...tab.tHead.rows[0].cells].forEach((th, i) => {
    th.querySelector('.seta')?.remove();
    if (th.classList.contains('ord')) th.setAttribute('aria-sort', i === col ? (dir > 0 ? 'ascending' : 'descending') : 'none');
    if (i === col) th.insertAdjacentHTML('beforeend', `<span class="seta">${dir > 0 ? ' ▲' : ' ▼'}</span>`);
  });
}
function ligarOrdenacao() {
  const tela = location.hash.split('?')[0].replace(/\/[0-9a-f-]{36}/gi, '/:id') || '#/';
  $$('main table.tbl').forEach((tab, n) => {
    if (!tab.tHead || !tab.tBodies[0] || tab.querySelector('tr.grp')) return;
    const chave = `automacao-ordem:${tela}:${n}`;
    [...tab.tHead.rows[0].cells].forEach((th, i) => {
      if (th.hasAttribute('data-nosort') || !th.textContent.trim()) return;
      th.classList.add('ord'); th.title = 'Clique para ordenar';
      th.onclick = () => {
        let atual = null; try { atual = JSON.parse(lerLocal(chave) || 'null'); } catch (_) {}
        const dir = atual?.col === i ? -atual.dir : 1;
        gravarLocal(chave, JSON.stringify({ col: i, dir })); ordenarTabela(tab, i, dir);
      };
    });
    try { const o = JSON.parse(lerLocal(chave) || 'null'); if (o && tab.tHead.rows[0].cells[o.col]?.classList.contains('ord')) ordenarTabela(tab, o.col, o.dir); } catch (_) {}
  });
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
// Os dados de uma tela ficam guardados por 20 s: trocar de aba, filtrar ou voltar não busca tudo de novo.
// Qualquer gravação (empresa, escritório, pedido de download) limpa o que estava guardado.
const limparCache = () => st.cache.clear();
function carregarBase(escritorioId) {
  const k = (escritorioId || '*') + '|' + st.comp, c = st.cache.get(k);
  if (c && Date.now() - c.em < 20000) return c.p;
  const p = buscarBase(escritorioId);
  st.cache.set(k, { em: Date.now(), p });
  p.catch(() => st.cache.delete(k));
  return p;
}
async function buscarBase(escritorioId) {
  const doEsc = c => escritorioId ? c.eq('escritorio_id', escritorioId) : c;
  const emp = () => doEsc(sb.from('empresas').select('*').eq('ativa', true)).order('razao_social').order('id');
  const dl = () => doEsc(sb.from('downloads').select('empresa_id,tipo,status,qtd_notas,mensagem,atualizado_em').eq('competencia', st.comp)).order('atualizado_em').order('id');
  const [escritorios, empresas, downloads, entregas] = await Promise.all([
    q(sb.from('escritorios').select('*').order('nome')),
    todos(emp), todos(dl),
    todos(() => sb.from('entregas').select('empresa_id,obrigacao,status').eq('competencia', st.comp).order('empresa_id').order('obrigacao')),
  ]);
  // último download de cada empresa/tipo
  const dlMap = {};
  for (const d of downloads) dlMap[d.empresa_id + d.tipo] = d;
  const entMap = {};
  for (const e of entregas) entMap[e.empresa_id + e.obrigacao] = e.status;
  return { escritorios, empresas, dlMap, entMap };
}
// Sem movimento: o download da competência terminou sem notas.
const semMov = (b, emp, tipo) => { const d = b.dlMap[emp.id + tipo]; return !!d && (d.status === 'sem_notas' || (d.status === 'concluido' && !d.qtd_notas)); };
const semMovTudo = (b, emp) => { const t = ['entrada', 'saida'].filter(x => emp['baixar_' + x]); return !!t.length && t.every(x => semMov(b, emp, x)); };
// Impt. NFs automática (enquanto ninguém marcou na mão), pelo download da competência:
//   entrada e saída sem notas → "Sem mov."; download confirmado com notas em pelo menos um lado → OK;
//   algum lado com erro, na fila ou ainda não baixado → Pend.
function statusImpt(b, emp) {
  const lados = ['entrada', 'saida'].filter(x => emp['baixar_' + x]).map(x => b.dlMap[emp.id + x]);
  if (!lados.length || lados.some(d => !d || !['concluido', 'sem_notas'].includes(d.status))) return 'pendente';
  return semMovTudo(b, emp) ? 'semmov' : 'ok';
}
const statusEnt = (b, emp, ob) => b.entMap[emp.id + ob] || (!emp.obrigacoes.includes(ob) ? 'na' : ob === 'impt_nfs' ? statusImpt(b, emp) : 'pendente');
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
function confirmar(titulo, texto, botao, cor = 'del') {
  return new Promise(resolve => {
    const fundo = document.createElement('div'); fundo.className = 'modal-fundo';
    fundo.innerHTML = `<div class="card modal" role="dialog" aria-modal="true"><h2>${h(titulo)}</h2><div style="font-size:14px;color:var(--ink2)">${h(texto)}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="mcanc">Cancelar</button><button type="button" class="btn ${cor}" id="mok">${h(botao)}</button></div></div>`;
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
    const pid = sel.value || meuPc();
    if (pid && eAdmin()) await sb.from('escritorios').update({ pc_padrao: pid }).eq('id', escritorioId);
  };
}

async function pedirExecucao(escritorioId, ie = null) {
  limparCache(); setTimeout(() => carregarMenu(true), 1500);
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
// Situação do download de cada empresa numa palavra só (usada nos filtros e nas barras coloridas)
const CHAVE_DL = { Erro: 'erro', 'Na fila': 'fila', 'Não baixado': 'nao', 'Atenção': 'atencao', OK: 'ok' };
const chaveDl = (b, e) => CHAVE_DL[statusDownload(b, e)[1]] || 'fora';   // fora = sem IE ou desligado
const emDiaEmp = (b, e) => OBRIG.every(([k]) => !['pendente', 'atrasado'].includes(statusEnt(b, e, k)));
// Card de número: ícone, valor (com contagem animada), linha de apoio e barrinha de progresso.
// cor: az (azul), vd (verde), am (amarelo), vm (vermelho), cz (cinza). Com href ou attrs vira clicável.
const KIC = { baixar: 'M12 3v12M7 10l5 5 5-5M4 21h16', notas: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6', ok: 'M5 12l4 4 10-10', erro: 'M12 3l9 16H3zM12 10v4M12 17h.01',
  emp: 'M4 21V5h10v16M14 9h6v12M8 9h2M8 13h2M8 17h2', entra: 'M12 4v14M6 12l6 6 6-6', sai: 'M12 20V6M6 12l6-6 6 6', sino: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4', troca: 'M4 8h14l-3-3M20 16H6l3 3', vazio: 'M5 12h14' };
const num = v => `<span class="num" data-n="${+v || 0}">${n(v)}</span>`;
function kpi({ ico, cor = 'az', l, v, de = '', sub = '', pct = null, href = '', attrs = '', on = false, d = '', extra = '', mini = false }) {
  const tag = href ? 'a' : attrs ? 'button' : 'div';
  return `<${tag} ${href ? `href="${href}"` : ''} ${tag === 'button' ? 'type="button"' : ''} ${attrs} class="card kpi k-${cor} ${mini ? 'mini' : 'pad'} ${tag !== 'div' ? 'clic' : ''} ${on ? 'on' : ''}">
    <i class="kic">${ic(KIC[ico])}</i><div class="l">${l}${d ? dica(d) : ''}</div><div class="v">${num(v)}${de !== '' ? `<small> ${de}</small>` : ''}</div>
    ${sub ? `<div class="tr">${sub}</div>` : ''}${extra}${pct != null ? `<div class="kbar"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>` : ''}${tag !== 'div' ? '<b class="kgo" aria-hidden="true">→</b>' : ''}</${tag}>`;
}
// Os números sobem do zero ao abrir a tela (não na atualização automática, para não distrair).
function animarNumeros() {
  if (st.quieto || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const els = $$('.num[data-n]').filter(e => +e.dataset.n > 0), t0 = performance.now(), dur = 450;
  const passo = t => { const k = Math.min(1, (t - t0) / dur), f = 1 - Math.pow(1 - k, 3);
    for (const e of els) e.textContent = n(Math.round(+e.dataset.n * f));
    if (k < 1) requestAnimationFrame(passo); };
  if (els.length) requestAnimationFrame(passo);
}
const dica = t => `<span class="q" tabindex="0" data-dica="${h(t)}">?</span>`;
async function telaPainel() {
  const vez = ++st.vez;
  if (!eAdmin()) return go('#/escritorio/' + st.perfil.escritorio_id);
  st.reexibir = telaPainel;
  const [b, alertas, creds] = await Promise.all([
    carregarBase(),
    q(sb.from('alertas').select('*, escritorios(nome), empresas(razao_social)').is('resolvido_em', null).order('criado_em', { ascending: false }).limit(6)),
    q(sb.from('credenciais_sefaz').select('escritorio_id,situacao')),
  ]);
  const sit = Object.fromEntries(creds.map(c => [c.escritorio_id, c.situacao]));
  let totE = 0, totS = 0;
  const T = { ok: 0, fila: 0, erro: 0, nao: 0, base: 0, emDia: 0 };
  const porEsc = b.escritorios.map(es => {
    const emps = b.empresas.filter(e => e.escritorio_id === es.id);
    const r = { es, emps, ne: 0, ns: 0, ok: 0, fila: 0, erro: 0, nao: 0, base: 0, emDia: 0, iesErro: [] };
    for (const e of emps) {
      r.ne += qtd(b, e, 'entrada') || 0; r.ns += qtd(b, e, 'saida') || 0;
      const k = chaveDl(b, e);
      if (k !== 'fora') { r.base++; r[k === 'atencao' ? 'ok' : k]++; if (k === 'erro') r.iesErro.push(e.ie); }
      if (emDiaEmp(b, e)) r.emDia++;
    }
    totE += r.ne; totS += r.ns;
    for (const k of Object.keys(T)) T[k] += r[k];
    return r;
  });
  const pct = (a, t) => t ? Math.round(a / t * 100) : 0;
  const C = 2 * Math.PI * 22, arco = C * pct(T.ok, T.base) / 100;
  const TIPO = { erro: ['er', 'Erro'], mudanca: ['mu', 'Mudança'], aviso: ['pe', 'Aviso'] };
  await layout(vez, 'painel', `
    <div class="top">
      <div><div class="sub">Visão de todos os escritórios · competência ${compNome(st.comp)}</div><h1>Painel geral</h1></div>
      <div class="filters">
        <label class="f">Competência<select id="comp">${compOpcoes()}</select></label>
        <a class="btn p lk" href="#/escritorios">+ Novo escritório</a>
      </div>
    </div>
    <section class="kpis">
      ${kpi({ ico: 'baixar', cor: T.base && T.ok === T.base ? 'vd' : 'az', l: 'Downloads concluídos', v: T.ok, de: 'de ' + T.base, href: '#/entregas?mostrar=falta', d: 'Empresas com entrada e saída já baixadas nesta competência. "Sem movimento" conta como concluído. Só entram empresas com IE e download ligado.',
        sub: `${pct(T.ok, T.base)}% · ${T.base - T.ok ? `faltam ${T.base - T.ok}` : 'tudo baixado'}`,
        extra: `<svg class="ring" width="54" height="54" aria-hidden="true"><circle cx="27" cy="27" r="22" fill="none" stroke="var(--line)" stroke-width="7"/><circle class="arco" cx="27" cy="27" r="22" fill="none" stroke="var(--ok)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${arco.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 27 27)"/></svg>` })}
      ${kpi({ ico: 'notas', cor: 'az', l: 'Notas baixadas', v: totE + totS, sub: `<span class="duo"><i class="le"></i>${n(totE)} entrada <i class="ls"></i>${n(totS)} saída</span>`,
        extra: `<div class="kbar duo"><span class="le" style="width:${pct(totE, totE + totS)}%"></span><span class="ls" style="width:${pct(totS, totE + totS)}%"></span></div>` })}
      ${kpi({ ico: 'ok', cor: b.empresas.length && T.emDia === b.empresas.length ? 'vd' : 'am', l: 'Entregas em dia', v: T.emDia, de: 'de ' + b.empresas.length, href: '#/entregas?mostrar=pendencia', d: 'Empresas sem nenhuma obrigação pendente ou atrasada nesta competência.',
        sub: b.empresas.length - T.emDia ? `${b.empresas.length - T.emDia} com pendência` : 'tudo em dia', pct: pct(T.emDia, b.empresas.length) })}
      ${kpi({ ico: 'erro', cor: T.erro ? 'vm' : 'vd', l: 'Empresas com erro', v: T.erro, href: '#/entregas?mostrar=erro', sub: T.erro ? 'precisam refazer' : 'nenhum erro', pct: T.erro ? pct(T.erro, T.base) : null })}
    </section>
    <section class="cols" style="grid-template-columns:2.9fr 1fr">
      <div class="card tbl-wrap">
        <div class="pad" style="padding-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h2>Escritórios</h2><div class="leg"><i class="g"></i>ok <i class="y"></i>na fila <i class="r"></i>erro <i class="z"></i>não baixado</div></div>
        ${porEsc.length ? `<table class="tbl"><thead><tr><th>Escritório</th><th class="c">Empresas</th><th>Downloads</th><th>Entregas</th><th data-nosort></th></tr></thead><tbody>
        ${porEsc.map(r => `<tr class="click" data-href="#/escritorio/${r.es.id}"><td><a href="#/escritorio/${r.es.id}" style="font-weight:600">${h(r.es.nome)}</a><div class="sub">Sefaz: ${{ ok: 'funcionando', recusada: 'senha recusada', erro: 'erro', nao_testado: 'não testado' }[sit[r.es.id]] || 'não cadastrado'}</div></td>
          <td class="c" title="${n(r.ne)} notas de entrada · ${n(r.ns)} de saída">${r.emps.length}</td>
          <td data-ord="${r.erro * 1e6 + r.fila * 1e3 + r.nao}"><div class="seg3" style="width:120px" title="${r.ok} ok · ${r.fila} na fila · ${r.erro} com erro · ${r.nao} não baixado"><b class="g" style="width:${pct(r.ok, r.base)}%"></b><b class="y" style="width:${pct(r.fila, r.base)}%"></b><b class="r" style="width:${pct(r.erro, r.base)}%"></b></div><div class="leg">${[[r.ok, 'ok'], [r.fila, 'na fila'], [r.erro, 'erro'], [r.nao, 'não baixado']].filter(x => x[0]).map(x => x.join(' ')).join(' · ') || 'nenhuma empresa com IE'}</div></td>
          <td data-ord="${pct(r.emDia, r.emps.length)}"><span class="bar" style="width:56px"><span style="width:${pct(r.emDia, r.emps.length)}%"></span></span> ${r.emDia} de ${r.emps.length}</td>
          <td><div class="acts">${r.erro ? `<button type="button" class="btn s p" data-refazer="${r.es.id}" title="Pede de novo só as empresas com erro">Refazer ${r.erro}</button>` : ''}${r.base ? `<button type="button" class="btn s" data-baixar-esc="${r.es.id}" title="Baixar todas as empresas deste escritório">Baixar</button>` : ''}</div></td></tr>`).join('')}
        </tbody></table>` : `<div class="empty">Nenhum escritório ainda. <a href="#/escritorios">Cadastre o primeiro</a>.</div>`}
      </div>
      <div class="card pad" style="display:flex;flex-direction:column;gap:14px">
        <h2>O que precisa de você</h2>
        ${alertas.length ? alertas.map(a => `<div style="display:flex;gap:10px;align-items:flex-start"><span class="pill ${TIPO[a.tipo][0]}">${TIPO[a.tipo][1]}</span>
          <div style="font-size:14px;min-width:0"><b>${h(a.escritorios?.nome || '')}</b> · ${h(a.titulo)}<div class="d">${h([a.empresas?.razao_social, a.detalhe].filter(Boolean).join(' · '))}</div>
          <div class="acts" style="justify-content:flex-start;margin-top:6px">${a.acao && ACAO_ALERTA[a.acao] ? `<button type="button" class="btn s p" data-acao="${a.acao}" data-esc="${a.escritorio_id}" data-id="${a.id}">${ACAO_ALERTA[a.acao]}</button>` : ''}<button type="button" class="btn s" data-resolver="${a.id}">Resolvido</button></div></div></div>`).join('') : '<div class="sub">Nada pendente. Nenhum alerta aberto.</div>'}
        <a href="#/alertas" style="font-size:14px;font-weight:600">Ver todos os alertas</a>
      </div>
    </section>`);
  $('#comp').onchange = e => { st.comp = e.target.value; telaPainel(); };
  $$('tr.click').forEach(tr => tr.onclick = ev => { if (!ev.target.closest('a,button')) go(tr.dataset.href); });
  $$('[data-refazer]').forEach(bt => bt.onclick = async () => {
    const r = porEsc.find(x => x.es.id === bt.dataset.refazer);
    bt.disabled = true; await pedirExecucao(r.es.id, r.iesErro.join(',')); telaPainel();
  });
  $$('[data-baixar-esc]').forEach(bt => bt.onclick = async () => {
    const r = porEsc.find(x => x.es.id === bt.dataset.baixarEsc);
    if (!await confirmar(`Baixar ${r.es.nome}?`, `Pede as notas de ${compNome(st.comp)} de todas as ${r.base} empresas com IE deste escritório.`, 'Baixar agora', 'p')) return;
    await pedirExecucao(r.es.id); telaPainel();
  });
  ligarAlertas(telaPainel);
}

// ---------- visão de entregas ----------
async function telaEntregas(filtro = { esc: '', mostrar: 'todas', busca: '' }) {
  const vez = ++st.vez;
  st.reexibir = () => telaEntregas(filtro);
  const b = await carregarBase(eAdmin() ? null : st.perfil.escritorio_id);
  // Cards: contam as empresas do escritório filtrado; clicar num card mostra só as pendentes daquela obrigação.
  const doEsc = () => b.empresas.filter(e => !filtro.esc || e.escritorio_id === filtro.esc);
  const kpisHtml = () => {
    const base = doEsc();
    const cards = OBRIG.map(([k, l]) => {
      let ok = 0, tot = 0;
      for (const e of base) { const s = statusEnt(b, e, k); if (s !== 'na') { tot++; if (FEITO(s)) ok++; } }
      const pend = tot - ok;
      return kpi({ mini: true, ico: !tot ? 'vazio' : pend ? 'notas' : 'ok', cor: !tot ? 'cz' : pend ? 'am' : 'vd', l, v: ok, de: '/ ' + tot, on: filtro.mostrar === 'ob:' + k, attrs: `data-kpi="ob:${k}" title="Mostrar só as pendentes de ${l}"`,
        sub: !tot ? 'ninguém tem' : pend ? `${pend} pendente${pend > 1 ? 's' : ''}` : 'tudo entregue', pct: tot ? Math.round(ok / tot * 100) : null });
    }).join('');
    const sme = base.filter(e => e.baixar_entrada && semMov(b, e, 'entrada')).length, sms = base.filter(e => e.baixar_saida && semMov(b, e, 'saida')).length;
    return cards + `<div class="card kpi mini k-cz"><i class="kic">${ic(KIC.vazio)}</i><div class="l">Sem movimento</div>
      <button type="button" class="lnk ${filtro.mostrar === 'semmov_entrada' ? 'on' : ''}" data-kpi="semmov_entrada">Entrada: <b>${sme}</b></button>
      <button type="button" class="lnk ${filtro.mostrar === 'semmov_saida' ? 'on' : ''}" data-kpi="semmov_saida">Saída: <b>${sms}</b></button></div>`;
  };
  const busca = filtro.busca.toLowerCase();
  const visivel = e => {
    if (filtro.esc && e.escritorio_id !== filtro.esc) return false;
    if (busca && ![e.razao_social, e.cnpj, e.ie, e.codigo].some(x => String(x || '').toLowerCase().includes(busca))) return false;
    if (filtro.mostrar === 'pendencia' && !OBRIG.some(([k]) => ['pendente', 'atrasado'].includes(statusEnt(b, e, k)))) return false;
    if (filtro.mostrar === 'erro' && statusDownload(b, e)[0] !== 'er') return false;
    if (filtro.mostrar === 'falta' && !['erro', 'fila', 'nao'].includes(chaveDl(b, e))) return false;
    if (filtro.mostrar.startsWith('ob:') && !['pendente', 'atrasado'].includes(statusEnt(b, e, filtro.mostrar.slice(3)))) return false;
    if (filtro.mostrar === 'semmov_entrada' && !(e.baixar_entrada && semMov(b, e, 'entrada'))) return false;
    if (filtro.mostrar === 'semmov_saida' && !(e.baixar_saida && semMov(b, e, 'saida'))) return false;
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
  await layout(vez, 'entregas', `
    <div class="top">
      <div><div class="sub">${eAdmin() ? 'Todas as empresas de todos os escritórios' : 'Empresas do seu escritório'}</div><h1>Visão geral de entregas</h1></div>
      <button type="button" class="btn" id="exportar">Exportar Excel</button>
    </div>
    <section class="kpis" id="kpis">${kpisHtml()}</section>
    <div class="filters">
      <label class="f">Competência<select id="comp">${compOpcoes()}</select></label>
      ${eAdmin() ? `<label class="f">Escritório<select id="fesc"><option value="">Todos</option>${b.escritorios.map(e => `<option value="${e.id}" ${e.id === filtro.esc ? 'selected' : ''}>${h(e.nome)}</option>`).join('')}</select></label>` : ''}
      <label class="f">Mostrar<select id="fmos"><option value="todas">Todas as empresas</option><option value="pendencia" ${filtro.mostrar === 'pendencia' ? 'selected' : ''}>Só com pendência</option><option value="erro" ${filtro.mostrar === 'erro' ? 'selected' : ''}>Só com erro no download</option><option value="falta" ${filtro.mostrar === 'falta' ? 'selected' : ''}>Download ainda não concluído</option><option value="semmov_entrada" ${filtro.mostrar === 'semmov_entrada' ? 'selected' : ''}>Sem movimento na entrada</option><option value="semmov_saida" ${filtro.mostrar === 'semmov_saida' ? 'selected' : ''}>Sem movimento na saída</option>${OBRIG.map(([k, l]) => `<option value="ob:${k}" ${filtro.mostrar === 'ob:' + k ? 'selected' : ''}>Pendentes de ${l}</option>`).join('')}</select></label>
      <label class="f">Buscar<input id="fbus" type="text" placeholder="Empresa, CNPJ ou IE" value="${h(filtro.busca)}" style="width:240px"></label>
    </div>
    <div class="card tbl-wrap">${linhas ? `<table class="tbl" id="tab"><thead><tr><th>Escritório / Empresa</th><th>Regime</th><th class="c">Notas E / S</th><th class="c">Download</th>${OBRIG.map(([, l]) => `<th class="c">${l}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table>` : '<div class="empty">Nenhuma empresa para mostrar.</div>'}</div>
    <div class="sub">Clique num status para trocar: Pendente → OK → N/A → Atraso. Impt. NFs se marca sozinha pelo download: OK = notas baixadas; "Sem mov." = sem notas na entrada e na saída; Pend. = erro ou download ainda não confirmado. Clique num card para ver só as pendentes dele; clique de novo para ver todas.</div>`);
  // O filtro vai para o endereço: F5 e o botão Voltar do navegador mantêm o que estava escolhido.
  const recarregar = () => {
    const f = { esc: $('#fesc')?.value || '', mostrar: $('#fmos').value, busca: $('#fbus').value };
    const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && v !== 'todas')).toString();
    history.replaceState(null, '', '#/entregas' + (qs ? '?' + qs : ''));
    return telaEntregas(f);
  };
  $('#comp').onchange = e => { st.comp = e.target.value; recarregar(); };
  if ($('#fesc')) $('#fesc').onchange = recarregar;
  $('#fmos').onchange = recarregar;
  let espera; $('#fbus').oninput = () => { clearTimeout(espera); espera = setTimeout(async () => {   // filtra enquanto digita
    await recarregar(); const i = $('#fbus'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 350); };
  const ligarKpis = () => $$('[data-kpi]').forEach(c => c.onclick = () => {
    const v = c.dataset.kpi; $('#fmos').value = filtro.mostrar === v ? 'todas' : v; recarregar();
  });
  ligarKpis();
  ligarEntregas(b, () => { $('#kpis').innerHTML = kpisHtml(); ligarKpis(); });   // cards atualizam na hora
  $('#exportar').onclick = async () => {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    const ws = XLSX.utils.table_to_sheet($('#tab'));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Entregas');
    XLSX.writeFile(wb, `entregas-${st.comp.slice(0, 7)}.xlsx`);
  };
}

// ---------- escritórios (admin) ----------
async function telaEscritorios() {
  const vez = ++st.vez;
  if (!eAdmin()) return go('#/escritorio/' + st.perfil.escritorio_id);
  const [escs, emps, creds] = await Promise.all([
    q(sb.from('escritorios').select('*').order('nome')),
    todos(() => sb.from('empresas').select('escritorio_id').eq('ativa', true).order('id')),
    q(sb.from('credenciais_sefaz').select('escritorio_id,situacao')),
  ]);
  const sit = Object.fromEntries(creds.map(c => [c.escritorio_id, c.situacao]));
  await layout(vez, 'escritorios', `
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
    limparCache(); toast('Escritório cadastrado.'); go('#/escritorio/' + es.id);
  };
}
// Contadores do escritório (vários logins da Sefaz, um por empresa). null se o banco ainda não tem a tabela.
async function carregarContadores(escritorioId) {
  if (!escritorioId) return null;
  const { data, error } = await sb.from('contadores').select('*').eq('escritorio_id', escritorioId).order('nome');
  return error ? null : data;
}
const pillContador = c => !c.cpf || !c.senha_secret_id ? '<span class="pill pe">Falta CPF e senha</span>' : pillSefaz(c.situacao);
function pillSefaz(s) {
  return { ok: '<span class="pill ok">Funcionando</span>', recusada: '<span class="pill er">Senha recusada</span>', erro: '<span class="pill er">Erro</span>', nao_testado: '<span class="pill pe">Não testado</span>' }[s] || '<span class="pill na">Não cadastrado</span>';
}

// ---------- escritório ----------
async function telaEscritorio(id, aba = 'empresas') {
  const vez = ++st.vez;
  if (!eAdmin() && id !== st.perfil.escritorio_id) return go('#/escritorio/' + st.perfil.escritorio_id);
  const [b, cred, pcs, conts] = await Promise.all([carregarBase(id), q(sb.from('credenciais_sefaz').select('*').eq('escritorio_id', id).maybeSingle()), carregarPcs(), carregarContadores(id)]);
  const nomeCont = Object.fromEntries((conts || []).map(c => [c.id, c.nome]));
  const temCont = !!conts?.length;
  const es = b.escritorios.find(e => e.id === id);
  if (!es) return layout(vez, 'escritorios', '<div class="empty">Escritório não encontrado.</div>');
  let ne = 0, ns = 0, emDia = 0;
  const D = { ok: 0, fila: 0, erro: 0, nao: 0, base: 0 }, porReg = {};
  for (const e of b.empresas) {
    ne += qtd(b, e, 'entrada') || 0; ns += qtd(b, e, 'saida') || 0;
    const k = chaveDl(b, e); if (k !== 'fora') { D.base++; D[k === 'atencao' ? 'ok' : k]++; }
    porReg[e.regime] = (porReg[e.regime] || 0) + 1;
    if (OBRIG.every(([k]) => !['pendente', 'atrasado'].includes(statusEnt(b, e, k)))) emDia++;
  }
  let corpo = '';
  const sel = selecao[id] = selecao[id] || new Set();
  const ORD_DL = { Erro: 0, 'Atenção': 1, 'Na fila': 2, 'Não baixado': 3, OK: 4, Desligado: 5, 'Sem IE': 6 };
  const fe = st.fEsc[id] = st.fEsc[id] || { q: '' }; fe.chip = fe.chip || 'todas'; fe.cont = temCont ? fe.cont || '' : '';
  if (aba !== 'usuarios') st.reexibir = () => telaEscritorio(id, aba);
  const CURTO = { impt_nfs: 'NFs', apuracao: 'Apur.', pgdas: 'DAS', efd_icms_ipi: 'ICMS', efd_contrib: 'Contrib.', mit: 'MIT', efd_reinf: 'Reinf' };
  // Linha de baixo do nome: o motivo do erro, a etapa do download ou quando terminou
  const infoDl = (e, c, l) => {
    const ds = ['entrada', 'saida'].filter(x => e['baixar_' + x]).map(x => b.dlMap[e.id + x]).filter(Boolean);
    if (!ds.length) return '';
    const ult = ds.reduce((x, d) => (x.atualizado_em > d.atualizado_em ? x : d));
    const linha = (t, cls = '') => `<div class="sub info ${cls}" title="${h(t)}">${h(t)}</div>`;
    if (c === 'er') { const d = ds.find(x => x.status === 'erro'); return linha(`${d.mensagem || 'Erro no download'} · ${haQuanto(d.atualizado_em)}`, 'er-t'); }
    if (l === 'Na fila') { const d = ds.find(x => ['fila', 'processando'].includes(x.status)); return linha(`${d.mensagem || (d.status === 'processando' ? 'Baixando…' : 'Na fila, esperando a vez')} · ${haQuanto(d.atualizado_em)}`); }
    if (semMovTudo(b, e)) return linha('Sem notas de entrada nem de saída no mês');
    if (l === 'Atenção') return linha('Um dos lados veio sem notas · ' + quando(ult.atualizado_em));
    if (c === 'ok') return linha('Baixado ' + quando(ult.atualizado_em));
    return '';
  };
  if (aba === 'empresas') {
    const cont = { erro: 0, fila: 0, nao: 0, atencao: 0, ok: 0, fora: 0, semmov: 0 };
    const linhas = b.empresas.map(e => {
      const [c, l] = statusDownload(b, e), k = chaveDl(b, e), sm = semMovTudo(b, e);
      cont[k]++; if (sm) cont.semmov++;
      const obs = OBRIG.filter(([o]) => statusEnt(b, e, o) !== 'na');
      const pend = obs.filter(([o]) => ['pendente', 'atrasado'].includes(statusEnt(b, e, o))).length;
      const bx = e.ie || (String(e.uf || '').toUpperCase() === 'DF' ? String(e.cnpj || '').replace(/\D/g, '') : '');   // DF baixa pelo CNPJ
      return `<tr class="click ${c === 'er' ? 'lin-er' : ''}" title="Clique na linha para abrir e editar a empresa" data-href="#/empresa/${e.id}" data-k="${k}" data-sm="${sm ? 1 : 0}" data-c="${e.contador_id || '-'}" data-t="${h(semAcento([e.razao_social, e.codigo, e.ie, e.cnpj, REGIMES[e.regime], nomeCont[e.contador_id]].join(' ')))} ${String(e.cnpj || '').replace(/\D/g, '')} ${String(e.ie || '').replace(/\D/g, '')}">
        <td class="chk-col">${bx ? `<input type="checkbox" class="selEmp" data-ie="${h(bx)}" aria-label="Selecionar ${h(e.razao_social)}" ${sel.has(bx) ? 'checked' : ''}>` : ''}</td><td>${h(e.codigo || '')}</td>
        <td data-ord="${h(e.razao_social)}"><div style="font-weight:600">${h(e.razao_social)}</div>${infoDl(e, c, l)}</td><td title="CNPJ ${h(e.cnpj || '—')}">${h(e.ie || '—')}${String(e.uf || '').toUpperCase() === 'DF' ? ' <span class="pill cont">DF</span>' : ''}</td>${temCont ? `<td data-ord="${h(nomeCont[e.contador_id] || '')}">${e.contador_id ? `<span class="pill cont">${h(nomeCont[e.contador_id] || '?')}</span>` : '<span class="sub">Escritório</span>'}</td>` : ''}<td>${REGIMES[e.regime] || '—'}</td>
        <td class="c">${qtd(b, e, 'entrada') ?? '—'}</td><td class="c">${qtd(b, e, 'saida') ?? '—'}</td><td data-ord="${ORD_DL[l] ?? 9}"><span class="pill ${sm ? 'sm' : c}">${sm ? 'Sem mov.' : l}</span></td>
        <td data-ord="${pend}">${obs.map(([o]) => { const s = statusEnt(b, e, o); return `<button type="button" class="s ${ST_ENT[s][0]}" data-emp="${e.id}" data-ob="${o}" data-st="${s}" data-curto="${CURTO[o]}" title="${CURTO[o]}: ${ST_ENT[s][1]} (clique para mudar)">${CURTO[o]}</button>`; }).join(' ') || '—'}</td>
        <td><div class="acts">${bx ? `<button type="button" class="btn s ${c === 'er' ? 'p' : ''}" data-baixar-ie="${h(bx)}" title="Baixar só esta empresa">${c === 'er' ? 'Refazer' : 'Baixar'}</button>` : ''}</div></td></tr>`;
    }).join('');
    const chip = (k, nome, qt) => qt || k === 'todas' ? `<button type="button" class="chip ${fe.chip === k ? 'on' : ''}" data-chip="${k}">${nome} <em>${qt}</em></button>` : '';
    corpo = `<div class="chips"><label class="busca" style="flex:0 1 300px;height:38px">${ic('M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z')}<input id="fq" type="text" placeholder="Filtrar: nome, código, IE, CNPJ ou regime" value="${h(fe.q)}" autocomplete="off"></label>
      ${temCont ? `<label class="f cont-f">Contador<select id="fcontador"><option value="">Todos</option>${conts.map(c => `<option value="${c.id}" ${fe.cont === c.id ? 'selected' : ''}>${h(c.nome)}</option>`).join('')}${b.empresas.some(e => !e.contador_id) ? `<option value="-" ${fe.cont === '-' ? 'selected' : ''}>Login do escritório</option>` : ''}</select></label>` : ''}
      ${chip('todas', 'Todas', b.empresas.length)}${chip('erro', '<i class="r"></i>Erro', cont.erro)}${chip('fila', '<i class="y"></i>Na fila', cont.fila)}${chip('nao', '<i class="z"></i>Não baixado', cont.nao)}${chip('atencao', 'Atenção', cont.atencao)}${chip('ok', '<i class="g"></i>OK', cont.ok)}${chip('semmov', 'Sem movimento', cont.semmov)}
      <span class="sub" id="fcont" style="margin-left:auto"></span></div>
    <div class="selbar card" id="selbar" hidden><span id="selqtd"></span><button type="button" class="btn s p" id="baixarSel">Baixar selecionadas</button><button type="button" class="btn s" id="marcarSel">Marcar entrega</button><button type="button" class="btn s" id="exportarSel">Exportar</button><button type="button" class="btn s" id="limparSel">Limpar</button></div>
    <div class="card tbl-wrap">${b.empresas.length ? `<table class="tbl" id="tabEmp"><thead><tr><th data-nosort class="chk-col"><input type="checkbox" id="selTodas" title="Selecionar todas as que estão aparecendo" aria-label="Selecionar todas"></th><th>Cód.</th><th>Empresa</th><th>IE</th>${temCont ? '<th>Contador</th>' : ''}<th>Regime</th><th class="c">Entrada</th><th class="c">Saída</th><th>Download</th><th>Entregas</th><th data-nosort></th></tr></thead><tbody>
      ${linhas}
      </tbody></table><div class="empty" id="fvazio" hidden>Nenhuma empresa com esse filtro. <a href="#" id="flimpar">Limpar filtro</a></div>` : `<div class="empty">Nenhuma empresa ainda. <a href="#/empresa/novo?esc=${id}">Cadastre</a> ou importe sua planilha.</div>`}</div>`;
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
  await layout(vez, eAdmin() ? 'escritorios' : 'escritorios', `
    <div class="top">
      <div>
        ${eAdmin() ? `<div class="sub"><a href="#/escritorios">Escritórios</a> / ${h(es.nome)}</div>` : ''}
        <h1>${h(es.nome)}</h1>
        <div style="display:flex;gap:10px;align-items:center;margin-top:6px;flex-wrap:wrap" class="sub">${pillSefaz(cred?.situacao)} ${cred ? `<span>Contador: CPF ${mascCpf(cred.cpf)}</span>` : ''} <a href="#/acesso?esc=${id}">Alterar acesso</a></div>
      </div>
      <div class="filters">
        <label class="f">Competência<select id="comp">${compOpcoes()}</select></label>
        ${seletorPc(es, pcs)}
        <button type="button" class="btn p" id="baixar" title="Baixar as notas de todas as empresas deste escritório">▶ Baixar agora</button>
        <a class="btn lk" href="#/rotina/${id}">Rotina</a>
        <a class="btn lk" href="#/empresa/novo?esc=${id}">+ Nova empresa</a>
        ${eAdmin() ? '<details class="mais"><summary class="btn">⋯ Mais</summary><div class="card mais-menu"><button type="button" id="editarEsc">Editar escritório</button><button type="button" id="excluirEsc" class="perigo">Excluir escritório</button></div></details>' : ''}
      </div>
    </div>
    <section class="kpis">
      ${kpi({ ico: 'emp', cor: 'az', l: 'Empresas', v: b.empresas.length, attrs: 'data-ir-chip="todas" title="Mostrar todas as empresas"', sub: Object.entries(porReg).sort((x, y) => y[1] - x[1]).map(([r, q]) => `${q} ${REGIMES[r] || 'sem regime'}`).join(' · ') })}
      ${kpi({ ico: 'baixar', cor: D.erro ? 'vm' : D.base && D.ok === D.base ? 'vd' : 'az', l: 'Downloads concluídos', v: D.ok, de: 'de ' + D.base, attrs: `data-ir-chip="${D.erro ? 'erro' : D.fila ? 'fila' : D.nao ? 'nao' : 'ok'}" title="Mostrar ${D.erro ? 'as empresas com erro' : D.fila ? 'as que estão na fila' : D.nao ? 'as que faltam baixar' : 'as concluídas'}"`,
        sub: [[D.erro, 'com erro'], [D.fila, 'na fila'], [D.nao, 'não baixado']].filter(x => x[0]).map(x => x.join(' ')).join(' · ') || 'tudo baixado', pct: D.base ? Math.round(D.ok / D.base * 100) : null })}
      ${kpi({ ico: 'notas', cor: 'az', l: 'Notas baixadas', v: ne + ns, sub: `<span class="duo"><i class="le"></i>${n(ne)} entrada <i class="ls"></i>${n(ns)} saída</span>`,
        extra: `<div class="kbar duo"><span class="le" style="width:${ne + ns ? Math.round(ne / (ne + ns) * 100) : 0}%"></span><span class="ls" style="width:${ne + ns ? 100 - Math.round(ne / (ne + ns) * 100) : 0}%"></span></div>` })}
      ${kpi({ ico: 'ok', cor: b.empresas.length && emDia === b.empresas.length ? 'vd' : 'am', l: 'Entregas em dia', v: emDia, de: 'de ' + b.empresas.length, href: `#/entregas?esc=${id}&mostrar=pendencia`,
        sub: b.empresas.length - emDia ? `${b.empresas.length - emDia} com pendência` : 'tudo em dia', pct: b.empresas.length ? Math.round(emDia / b.empresas.length * 100) : null })}
    </section>
    <div class="tabs">
      <button type="button" class="tab ${aba === 'empresas' ? 'on' : ''}" data-aba="empresas">Empresas</button>
      <button type="button" class="tab ${aba === 'downloads' ? 'on' : ''}" data-aba="downloads">Downloads</button>
      ${eAdmin() ? `<button type="button" class="tab ${aba === 'usuarios' ? 'on' : ''}" data-aba="usuarios">Usuários do escritório</button>` : ''}
    </div>
    ${corpo}`);
  // A aba e o filtro vão para o endereço: F5 e o botão Voltar do navegador mantêm onde a pessoa estava.
  const endereco = a => { const p = new URLSearchParams(); if (a !== 'empresas') p.set('aba', a); if (fe.chip !== 'todas') p.set('f', fe.chip);
    const qs = p.toString(); history.replaceState(null, '', '#/escritorio/' + id + (qs ? '?' + qs : '')); };
  $('#comp').onchange = e => { st.comp = e.target.value; telaEscritorio(id, aba); };
  $$('[data-aba]').forEach(t => t.onclick = () => { endereco(t.dataset.aba); telaEscritorio(id, t.dataset.aba); });
  $$('tr.click').forEach(tr => tr.onclick = ev => { if (!ev.target.closest('a,button,input')) go(tr.dataset.href); });
  const mais = $('details.mais'); if (mais) mais.querySelectorAll('button').forEach(x => x.addEventListener('click', () => { mais.open = false; }));
  // Filtro na hora (sem buscar nada de novo): caixa de texto + botões com a contagem
  const filtrar = () => {
    const tab = $('#tabEmp'); if (!tab) return;
    const t = semAcento(fe.q.trim()); let vis = 0;
    for (const tr of tab.tBodies[0].rows) {
      const ok = (fe.chip === 'todas' || (fe.chip === 'semmov' ? tr.dataset.sm === '1' : tr.dataset.k === fe.chip)) && (!t || tr.dataset.t.includes(t)) && (!fe.cont || tr.dataset.c === fe.cont);
      tr.hidden = !ok; if (ok) vis++;
    }
    $$('[data-chip]').forEach(c => c.classList.toggle('on', c.dataset.chip === fe.chip));
    $('#fcont').textContent = vis === b.empresas.length ? '' : `mostrando ${vis} de ${b.empresas.length}`;
    $('#fvazio').hidden = vis > 0; tab.hidden = !vis;
  };
  if ($('#fq')) {
    $('#fq').oninput = e => { fe.q = e.target.value; filtrar(); atualizarSel(); };
    if ($('#fcontador')) $('#fcontador').onchange = e => { fe.cont = e.target.value; filtrar(); atualizarSel(); };
    $$('[data-chip]').forEach(c => c.onclick = () => { fe.chip = fe.chip === c.dataset.chip ? 'todas' : c.dataset.chip; endereco(aba); filtrar(); atualizarSel(); });
    if ($('#flimpar')) $('#flimpar').onclick = ev => { ev.preventDefault(); fe.q = ''; fe.chip = 'todas'; fe.cont = ''; if ($('#fcontador')) $('#fcontador').value = ''; $('#fq').value = ''; endereco(aba); filtrar(); atualizarSel(); };
  }
  ligarEntregas(b);
  $$('[data-ir-chip]').forEach(c => c.onclick = () => { fe.chip = c.dataset.irChip; fe.q = ''; endereco('empresas'); if (aba !== 'empresas') return telaEscritorio(id, 'empresas'); $('#fq').value = ''; filtrar(); atualizarSel(); $('.chips')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  ligarSeletorPc(id);
  $('#baixar').onclick = () => pedirExecucao(id);
  $$('[data-baixar-ie]').forEach(bt => bt.onclick = ev => { ev.stopPropagation(); pedirExecucao(id, bt.dataset.baixarIe); });
  // Selecionar algumas empresas e baixar só elas
  const caixas = () => $$('.selEmp').filter(cx => !cx.closest('tr').hidden);   // só as que estão aparecendo
  const atualizarSel = () => {
    const bar = $('#selbar'); if (!bar) return;
    bar.hidden = !sel.size;
    $('#selqtd').innerHTML = `<b>${sel.size}</b> ${sel.size === 1 ? 'empresa selecionada' : 'empresas selecionadas'}`;
    const todas = $('#selTodas'), cx = caixas(), marc = cx.filter(x => x.checked).length;
    if (todas) { todas.checked = !!cx.length && marc === cx.length; todas.indeterminate = marc > 0 && marc < cx.length; }
  };
  $$('.selEmp').forEach(cx => {
    cx.onclick = ev => ev.stopPropagation();
    cx.onchange = () => { cx.checked ? sel.add(cx.dataset.ie) : sel.delete(cx.dataset.ie); atualizarSel(); };
    cx.parentElement.onclick = ev => { ev.stopPropagation(); if (ev.target !== cx) { cx.checked = !cx.checked; cx.onchange(); } };
  });
  if ($('#selTodas')) {
    $('#selTodas').parentElement.onclick = ev => ev.stopPropagation();
    $('#selTodas').onchange = e => { caixas().forEach(cx => { cx.checked = e.target.checked; cx.checked ? sel.add(cx.dataset.ie) : sel.delete(cx.dataset.ie); }); atualizarSel(); };
  }
  if ($('#limparSel')) $('#limparSel').onclick = () => { sel.clear(); $$('.selEmp').forEach(cx => cx.checked = false); atualizarSel(); };
  const escolhidas = () => b.empresas.filter(e => e.ie && sel.has(e.ie));
  // Marcar a mesma entrega em várias empresas de uma vez
  if ($('#marcarSel')) $('#marcarSel').onclick = async () => {
    const r = await new Promise(resolve => {
      const fundo = document.createElement('div'); fundo.className = 'modal-fundo';
      fundo.innerHTML = `<form class="card modal" role="dialog" aria-modal="true"><h2 style="font-size:18px">Marcar entrega em ${sel.size} ${sel.size === 1 ? 'empresa' : 'empresas'}</h2>
        <div class="sub">Competência ${compNome(st.comp)}. Só muda nas empresas que têm essa obrigação no cadastro.</div>
        <label class="f">Obrigação<select name="ob">${OBRIG.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="f">Marcar como<select name="st"><option value="ok">OK (entregue)</option><option value="pendente">Pendente</option><option value="atrasado">Atraso</option><option value="na">N/A</option></select></label>
        <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="mcanc">Cancelar</button><button type="submit" class="btn p">Marcar</button></div></form>`;
      document.body.appendChild(fundo);
      const fechar = v => { fundo.remove(); resolve(v); };
      fundo.querySelector('#mcanc').onclick = () => fechar(null);
      fundo.onclick = e => { if (e.target === fundo) fechar(null); };
      fundo.querySelector('form').onsubmit = e => { e.preventDefault(); const fd = new FormData(e.target); fechar({ ob: fd.get('ob'), st: fd.get('st') }); };
    });
    if (!r) return;
    const alvo = escolhidas().filter(e => e.obrigacoes.includes(r.ob));
    if (!alvo.length) return toast('Nenhuma das empresas escolhidas tem essa obrigação no cadastro.');
    await q(sb.from('entregas').upsert(alvo.map(e => ({ empresa_id: e.id, competencia: st.comp, obrigacao: r.ob, status: r.st, atualizado_por: st.session.user.id, atualizado_em: new Date().toISOString() }))));
    limparCache(); toast(`Entrega marcada em ${alvo.length} ${alvo.length === 1 ? 'empresa' : 'empresas'}.`); telaEscritorio(id, aba);
  };
  if ($('#exportarSel')) $('#exportarSel').onclick = async () => {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    const dados = [['Código', 'Empresa', 'IE', 'CNPJ', 'Regime', 'Notas entrada', 'Notas saída', 'Download', ...OBRIG.map(x => x[1])],
      ...escolhidas().map(e => [e.codigo || '', e.razao_social, e.ie || '', e.cnpj || '', REGIMES[e.regime] || '', qtd(b, e, 'entrada') ?? '', qtd(b, e, 'saida') ?? '', statusDownload(b, e)[1], ...OBRIG.map(([k]) => ST_ENT[statusEnt(b, e, k)][1])])];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dados), 'Empresas');
    XLSX.writeFile(wb, `empresas-${es.nome.replace(/[^\w]+/g, '-').toLowerCase()}-${st.comp.slice(0, 7)}.xlsx`);
  };
  if ($('#baixarSel')) $('#baixarSel').onclick = async () => {
    const ies = [...sel]; if (!ies.length) return;
    await pedirExecucao(id, ies.join(','));
    sel.clear(); $$('.selEmp').forEach(cx => cx.checked = false); atualizarSel();
  };
  filtrar(); atualizarSel();
  if ($('#editarEsc')) $('#editarEsc').onclick = async () => {
    if (await editarEscritorio(es)) telaEscritorio(id, aba);
  };
  if ($('#excluirEsc')) $('#excluirEsc').onclick = async () => {
    const ok = await confirmarComSenha(`Excluir ${es.nome}?`, `Apaga o escritório, as ${b.empresas.length} empresas dele, o histórico de downloads, as entregas, os alertas e a senha da Sefaz. Não tem como desfazer. Os XMLs já salvos no computador continuam lá.`);
    if (!ok) return;
    await q(sb.from('escritorios').delete().eq('id', id));
    limparCache(); toast('Escritório excluído.'); go('#/escritorios');
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
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
// Planilha: se a coluna UF trouxer o nome da cidade, ele vai para Cidade e a UF fica GO.
function ufCidade(uf, cidade) {
  const u = String(uf ?? '').trim().toUpperCase(), c = String(cidade ?? '').trim();
  return UFS.includes(u) ? { uf: u, cidade: c || null } : { uf: 'GO', cidade: c || String(uf ?? '').trim() || null };
}
async function telaEmpresa(id, params) {
  const vez = ++st.vez;
  const nova = id === 'novo';
  const [empBanco, escs, rotinas] = await Promise.all([
    nova ? null : q(sb.from('empresas').select('*').eq('id', id).maybeSingle()),
    q(sb.from('escritorios').select('id,nome').order('nome')),
    q(sb.from('rotinas').select('escritorio_id,pasta_destino')),
  ]);
  if (!nova && !empBanco) return naoEncontrado('Empresa não encontrada', 'Ela pode ter sido excluída, ou o link está desatualizado.');
  const emp = empBanco || { escritorio_id: params.get('esc') || st.perfil.escritorio_id, uf: 'GO', cidade: '', baixar_entrada: true, baixar_saida: true, incluir_eventos: true, modelo: 'todos', exibir_canceladas: false, obrigacoes: ['impt_nfs', 'apuracao'] };
  const es = escs.find(e => e.id === emp.escritorio_id);
  const rot = rotinas.find(r => r.escritorio_id === emp.escritorio_id);
  const sel = (v, a) => v === a ? 'selected' : '';
  const conts = await carregarContadores(emp.escritorio_id);
  await layout(vez, 'escritorios', `
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
            <label class="f">UF<select name="uf" id="ufEmp">${UFS.map(u => `<option value="${u}" ${sel(u, UFS.includes(emp.uf) ? emp.uf : 'GO')}>${u}${u === 'GO' ? ' — Sefaz Goiás (pela IE)' : u === 'DF' ? ' — Agênci@Net (pelo CNPJ)' : ''}</option>`).join('')}</select></label></div>
          <label class="f">Cidade<input name="cidade" value="${h(emp.cidade || (UFS.includes(emp.uf) ? '' : emp.uf || ''))}" placeholder="opcional"></label>
          <div class="g2"><label class="f">Regime<select name="regime"><option value="">—</option>${Object.entries(REGIMES).map(([k, l]) => `<option value="${k}" ${sel(k, emp.regime)}>${l}</option>`).join('')}</select></label>
            <label class="f">Atividade<input name="atividade" value="${h(emp.atividade)}" placeholder="comércio, serviço, indústria"></label></div>
        </section>
        <section class="card pad" style="display:flex;flex-direction:column;gap:12px">
          <h2 id="tDl">${emp.uf === 'DF' ? 'Download de notas no DF (Agênci@Net)' : 'Download de notas na Sefaz-GO'}</h2>
          <div class="sub" id="sGo" ${emp.uf === 'DF' ? 'hidden' : ''}>O robô usa o login do contador e a inscrição estadual acima. Sem IE, a empresa fica só no controle de entregas.</div>
          <div class="sub" id="sDf" ${emp.uf === 'DF' ? '' : 'hidden'}>No DF a extensão solicita os XMLs pelo <b>CNPJ</b> (a IE não é usada), com o certificado digital do escritório (procuração) aberto no Chrome. Entrada = Destinatário, Saída = Emitente; o modelo abaixo decide NF-e, NFC-e ou as duas. O DF pode levar até 2 dias para liberar: a extensão confere a cada 30 min e baixa sozinha. Salva na mesma pasta (EMPRESA &rsaquo; NOTAS &rsaquo; MMAAAA).</div>
          ${conts ? `<label class="f" id="contGo" ${emp.uf === 'DF' ? 'hidden' : ''}>Contador (login usado na Sefaz)<select name="contador_id"><option value="">Login do escritório (padrão)</option>${conts.map(c => `<option value="${c.id}" ${sel(c.id, emp.contador_id)}>${h(c.nome)}${!c.cpf || !c.senha_secret_id ? ' — falta CPF e senha' : ''}</option>`).join('')}</select>
            <span class="sub" style="font-weight:400">Em branco = usa o login do escritório. Os contadores ficam em <a href="#/acesso?esc=${emp.escritorio_id}">Acesso à Sefaz</a>.</span></label>` : ''}
          <div class="g2"><div>
            <label class="chk"><input type="checkbox" name="baixar_entrada" ${emp.baixar_entrada ? 'checked' : ''}>Baixar notas de entrada</label>
            <label class="chk"><input type="checkbox" name="baixar_saida" ${emp.baixar_saida ? 'checked' : ''}>Baixar notas de saída</label>
            <label class="chk" id="evGo" ${emp.uf === 'DF' ? 'hidden' : ''}><input type="checkbox" name="incluir_eventos" ${emp.incluir_eventos ? 'checked' : ''}>Incluir eventos (cancelamento, CC-e)</label></div>
            <div style="display:flex;flex-direction:column;gap:12px">
            <label class="f">Modelo da NF-e<select name="modelo"><option value="todos" ${sel('todos', emp.modelo)}>Todos</option><option value="55" ${sel('55', emp.modelo)}>55 (NF-e)</option><option value="65" ${sel('65', emp.modelo)}>65 (NFC-e)</option></select></label>
            <label class="f" id="cancGo" ${emp.uf === 'DF' ? 'hidden' : ''}>Notas canceladas<select name="exibir_canceladas"><option value="false">Não exibir</option><option value="true" ${emp.exibir_canceladas ? 'selected' : ''}>Exibir</option></select></label></div></div>
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
          <div style="display:flex;gap:10px"><a class="btn lk" href="#/escritorio/${emp.escritorio_id}" >Cancelar</a><button class="btn p" type="submit">Salvar empresa</button></div>
        </div>
      </form>
      <aside class="card pad" style="display:flex;flex-direction:column;gap:14px">
        <h2>Importar várias de uma vez</h2>
        <div style="font-size:14px;color:var(--ink2)">Envie a planilha que você usa hoje. Colunas lidas: Código, IE, CNPJ, Clientes, Regime, Atividade, UF, Cidade.</div>
        <label class="btn o" style="display:inline-flex;align-items:center;justify-content:center">Importar planilha Excel<input type="file" id="arq" accept=".xlsx,.xls,.csv" hidden></label>
        <div id="imp" class="sub"></div>
      </aside>
    </div>`);
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('uf') === 'DF' && String(fd.get('cnpj') || '').replace(/\D/g, '').length < 11) { toast('Empresa do DF: preencha o CNPJ (o download no DF é feito pelo CNPJ).'); return; }
    const reg = {
      escritorio_id: fd.get('escritorio_id') || emp.escritorio_id,
      codigo: fd.get('codigo') || null, razao_social: fd.get('razao_social').trim(), cnpj: fd.get('cnpj') || null,
      ie: (fd.get('ie') || '').replace(/\D/g, '') || null, uf: fd.get('uf') || 'GO', cidade: (fd.get('cidade') || '').trim() || null, regime: fd.get('regime') || null,
      atividade: fd.get('atividade') || null, baixar_entrada: fd.has('baixar_entrada'), baixar_saida: fd.has('baixar_saida'),
      incluir_eventos: fd.has('incluir_eventos'), modelo: fd.get('modelo'), exibir_canceladas: fd.get('exibir_canceladas') === 'true',
      obrigacoes: OBRIG.map(([k]) => k).filter(k => fd.has('ob_' + k)),
      pasta: (fd.get('pasta') || '').trim().replace(/[\\/]+$/, '') || null,
    };
    // Contador: só os do escritório desta empresa (mudou de escritório = volta para o login do escritório).
    if (conts) reg.contador_id = reg.escritorio_id === emp.escritorio_id ? fd.get('contador_id') || null : null;
    if (nova) await q(sb.from('empresas').insert(reg)); else await q(sb.from('empresas').update(reg).eq('id', id));
    limparCache(); toast('Empresa salva.'); go('#/escritorio/' + reg.escritorio_id);
  };
  $('#ufEmp').onchange = () => {
    const df = $('#ufEmp').value === 'DF';
    $('#tDl').textContent = df ? 'Download de notas no DF (Agênci@Net)' : 'Download de notas na Sefaz-GO';
    ['#sGo', '#contGo', '#evGo', '#cancGo'].forEach(x => { if ($(x)) $(x).hidden = df; }); $('#sDf').hidden = !df;
  };
  if ($('#excluirEmp')) $('#excluirEmp').onclick = async () => {
    const ok = await confirmarComSenha(`Excluir ${emp.razao_social}?`, 'Apaga a empresa, o histórico de downloads e as entregas dela. Não tem como desfazer. Se for só parar de baixar, use Desativar.');
    if (!ok) return;
    await q(sb.from('empresas').delete().eq('id', id));
    limparCache(); toast('Empresa excluída.'); go('#/escritorio/' + emp.escritorio_id);
  };
  if ($('#desativar')) $('#desativar').onclick = async () => {
    if (!confirm('Desativar esta empresa? Ela some dos painéis e o robô para de baixar.')) return;
    await q(sb.from('empresas').update({ ativa: false }).eq('id', id)); limparCache(); go('#/escritorio/' + emp.escritorio_id);
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
  const c = { cod: col('CODIGO', 'COD'), ie: col('IE', 'INSCRICAO ESTADUAL'), cnpj: col('CNPJ'), nome: col('CLIENTES', 'CLIENTE', 'RAZAO SOCIAL', 'EMPRESA'), reg: col('REGIME'), atv: col('ATIVIDADE'), uf: col('UF'), cid: col('CIDADE', 'MUNICIPIO') };
  const regime = r => { const x = norm(r); return x.startsWith('SIMPLES') ? 'simples' : x.includes('PRESUMIDO') ? 'presumido' : x.includes('REAL') ? 'real' : x.includes('MEI') ? 'mei' : x ? 'outro' : null; };
  const regs = linhas.slice(ih + 1).filter(r => c.nome >= 0 && String(r[c.nome]).trim()).map(r => ({
    escritorio_id: escritorioId, codigo: c.cod >= 0 ? String(r[c.cod]).trim() || null : null,
    ie: c.ie >= 0 ? String(r[c.ie]).replace(/\D/g, '') || null : null, cnpj: c.cnpj >= 0 ? String(r[c.cnpj]).trim() || null : null,
    razao_social: String(r[c.nome]).trim(), regime: c.reg >= 0 ? regime(r[c.reg]) : null,
    atividade: c.atv >= 0 ? String(r[c.atv]).trim() || null : null, ...ufCidade(c.uf >= 0 ? r[c.uf] : '', c.cid >= 0 ? r[c.cid] : ''),
    obrigacoes: ['impt_nfs', 'apuracao'].concat(c.reg >= 0 && regime(r[c.reg]) === 'simples' ? ['pgdas'] : []),
  }));
  if (!regs.length) return $('#imp').textContent = 'Nenhuma empresa encontrada na planilha.';
  if (!confirm(`Importar ${regs.length} empresas para este escritório?`)) return;
  await q(sb.from('empresas').insert(regs));
  limparCache(); st.indice = null; toast(`${regs.length} empresas importadas.`); go('#/escritorio/' + escritorioId);
}

// ---------- alertas ----------
async function telaAlertas(f = { aba: 'abertos', tipo: '', esc: '' }) {
  const vez = ++st.vez;
  let qr = sb.from('alertas').select('*, escritorios(nome), empresas(razao_social)').order('criado_em', { ascending: false }).limit(200);
  if (f.aba === 'abertos') qr = qr.is('resolvido_em', null);
  if (f.aba === 'resolvidos') qr = qr.not('resolvido_em', 'is', null);
  if (f.tipo) qr = qr.eq('tipo', f.tipo);
  if (f.esc) qr = qr.eq('escritorio_id', f.esc);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const [lista, abertos, resolvHoje, escs] = await Promise.all([
    q(qr), todos(() => sb.from('alertas').select('tipo').is('resolvido_em', null).order('id')),
    sb.from('alertas').select('id', { count: 'exact', head: true }).gte('resolvido_em', hoje.toISOString()),
    q(sb.from('escritorios').select('id,nome').order('nome')),
  ]);
  const cnt = t => abertos.filter(a => a.tipo === t).length;
  const TAG = { erro: ['er', 'ERRO'], mudanca: ['mu', 'MUDANÇA'], aviso: ['pe', 'AVISO'] };
  const ACAO = ACAO_ALERTA;
  st.reexibir = () => telaAlertas(f);
  await layout(vez, 'alertas', `
    <div class="top"><div><div class="sub">Erros e mudanças de qualquer empresa${eAdmin() ? ', de todos os escritórios' : ''}</div><h1>Alertas</h1></div></div>
    <section class="kpis">
      ${kpi({ ico: 'erro', cor: cnt('erro') ? 'vm' : 'cz', l: 'Erros', v: cnt('erro'), sub: 'precisam de ação', on: f.tipo === 'erro', attrs: 'data-tipo="erro" title="Mostrar só os erros"' })}
      ${kpi({ ico: 'troca', cor: cnt('mudanca') ? 'az' : 'cz', l: 'Mudanças', v: cnt('mudanca'), sub: 'notas ou cadastro alterados', on: f.tipo === 'mudanca', attrs: 'data-tipo="mudanca" title="Mostrar só as mudanças"' })}
      ${kpi({ ico: 'sino', cor: cnt('aviso') ? 'am' : 'cz', l: 'Avisos', v: cnt('aviso'), sub: 'vale conferir', on: f.tipo === 'aviso', attrs: 'data-tipo="aviso" title="Mostrar só os avisos"' })}
      ${kpi({ ico: 'ok', cor: 'vd', l: 'Resolvidos hoje', v: resolvHoje.count || 0, sub: 'ver os resolvidos', on: f.aba === 'resolvidos', attrs: 'data-ver-resolvidos title="Mostrar os resolvidos"' })}
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
  $$('[data-tipo]').forEach(c => c.onclick = () => rec({ aba: 'abertos', tipo: f.tipo === c.dataset.tipo && f.aba === 'abertos' ? '' : c.dataset.tipo }));
  $('[data-ver-resolvidos]').onclick = () => rec({ aba: f.aba === 'resolvidos' ? 'abertos' : 'resolvidos', tipo: '' });
  $('#ftipo').onchange = () => rec(); if ($('#fesc')) $('#fesc').onchange = () => rec();
  ligarAlertas(() => rec());
}

// ---------- acesso à Sefaz ----------
async function telaAcesso(params) {
  const vez = ++st.vez;
  const [escs, creds, pcs, todosCont] = await Promise.all([
    q(sb.from('escritorios').select('id,nome').order('nome')),
    q(sb.from('credenciais_sefaz').select('*')),
    carregarPcs(),
    sb.from('contadores').select('escritorio_id').then(r => r.data || []),
  ]);
  const cm = Object.fromEntries(creds.map(c => [c.escritorio_id, c]));
  const nCont = {}; for (const x of todosCont) nCont[x.escritorio_id] = (nCont[x.escritorio_id] || 0) + 1;
  const selId = params.get('esc') || (eAdmin() ? escs[0]?.id : st.perfil.escritorio_id);
  const es = escs.find(e => e.id === selId); const c = cm[selId];
  const [conts, empsEsc] = es ? await Promise.all([carregarContadores(selId),
    sb.from('empresas').select('contador_id').eq('escritorio_id', selId).eq('ativa', true).then(r => r.data || [])]) : [null, []];
  const nEmp = {}; let semCont = 0;
  for (const e of empsEsc) { if (e.contador_id) nEmp[e.contador_id] = (nEmp[e.contador_id] || 0) + 1; else semCont++; }
  const contId = params.get('cont');
  const qsCont = v => `#/acesso?esc=${selId}&cont=${v}`;
  const ePadrao = contId === 'padrao';
  const ct = !conts || ePadrao ? null : contId === 'novo' ? {} : conts.find(x => x.id === contId) || null;
  const cab = (t, nome) => `<div><div class="sub" style="text-transform:uppercase;letter-spacing:.06em;font-weight:600">${t} · ${h(es.nome)}</div><h2 style="font-size:18px;margin-top:4px">${nome}</h2></div>`;
  const cancelar = '<button type="button" class="btn" data-cancelar>Cancelar</button>';
  await layout(vez, 'acesso', `
    <div class="top"><div><div class="sub">Login do contador usado pelo robô, um por escritório</div><h1>Acesso à Sefaz-GO</h1></div></div>
    <section class="card tbl-wrap">${escs.length ? `<table class="tbl"><thead><tr><th>Escritório</th><th>Contador padrão</th><th>CPF</th><th class="c">Contadores</th><th>Situação</th><th>Último teste</th><th>Senha alterada</th></tr></thead><tbody>
      ${escs.map(e => { const x = cm[e.id]; return `<tr class="click ${e.id === selId ? 'sel-row' : ''}" data-href="#/acesso?esc=${e.id}"><td style="font-weight:600">${h(e.nome)}</td><td>${h(x?.nome_contador || '—')}</td><td>${x ? mascCpf(x.cpf) : '—'}</td>
        <td class="c">${(x ? 1 : 0) + (nCont[e.id] || 0)}</td><td>${pillSefaz(x?.situacao)}</td><td>${quando(x?.ultimo_teste)}</td><td>${x?.alterada_em ? new Date(x.alterada_em).toLocaleDateString('pt-BR') : '—'}</td></tr>`; }).join('')}
    </tbody></table>` : '<div class="empty">Cadastre um escritório primeiro.</div>'}</section>
    ${es ? `<div class="cols form" id="contadores">
      <section class="card tbl-wrap"><div class="pad" style="padding-bottom:8px"><h2>Contadores do escritório ${h(es.nome)}</h2><div class="sub" style="margin-top:4px">Cada empresa baixa com o login do seu contador (escolhido no cadastro da empresa). Empresas sem contador usam o login padrão do escritório.</div></div>
        <table class="tbl"><thead><tr><th>Contador</th><th>CPF</th><th class="c">Empresas</th><th>Situação</th><th>Último teste</th><th></th></tr></thead><tbody>
        <tr class="click ${ePadrao ? 'sel-row' : ''}" data-href="${qsCont('padrao')}"><td style="font-weight:600">${h(c?.nome_contador || (c ? 'Login do escritório' : 'Login padrão não cadastrado'))} <span class="pill na" style="margin-left:6px">Padrão do escritório</span></td>
          <td>${c ? mascCpf(c.cpf) : '—'}</td><td class="c">${semCont}${conts?.length ? ' sem contador' : ''}</td><td>${pillSefaz(c?.situacao)}</td><td>${quando(c?.ultimo_teste)}</td>
          <td style="text-align:right"><a class="btn s lk" href="${qsCont('padrao')}">${c ? 'Editar' : 'Cadastrar'}</a></td></tr>
        ${(conts || []).map(x => `<tr class="click ${ct?.id === x.id ? 'sel-row' : ''}" data-href="${qsCont(x.id)}"><td style="font-weight:600">${h(x.nome)}</td><td>${x.cpf ? mascCpf(x.cpf) : '—'}</td><td class="c">${nEmp[x.id] || 0}</td>
          <td>${pillContador(x)}</td><td>${quando(x.ultimo_teste)}</td><td style="text-align:right"><a class="btn s lk" href="${qsCont(x.id)}">Editar</a></td></tr>`).join('')}
        </tbody></table>
        ${conts ? `<div class="pad" style="padding-top:12px"><a class="btn o s lk" href="${qsCont('novo')}">+ Novo contador</a></div>` : ''}</section>
      ${ePadrao ? `<form class="card pad" id="f" style="display:flex;flex-direction:column;gap:12px">
        ${cab(c ? 'Editando login padrão' : 'Cadastrar login padrão', h(c?.nome_contador || 'Login do escritório'))}
        ${c?.situacao === 'recusada' ? `<div class="msg err">A Sefaz recusou a senha ${quando(c.ultimo_teste)}. Se ela mudou, atualize aqui.</div>` : ''}
        <label class="f">Nome do contador<input name="nome" value="${h(c?.nome_contador)}"></label>
        <label class="f">CPF do contador<input name="cpf" required inputmode="numeric" value="${h(c?.cpf)}"></label>
        <label class="f">${c?.senha_secret_id ? 'Nova senha da Sefaz' : 'Senha da Sefaz'}<input name="senha" type="password" autocomplete="new-password" ${c?.senha_secret_id ? 'placeholder="Deixe em branco para manter a atual"' : 'required'}></label>
        <label class="chk"><input type="checkbox" id="ver">Mostrar senha</label>
        <label class="chk"><input type="checkbox" name="rodar" checked>Ao salvar, já rodar os downloads</label>
        <button class="btn p" type="submit">Salvar</button>${cancelar}
        <div class="sub">A senha fica guardada criptografada. Depois de salva, ninguém consegue ver, só trocar.${c?.alterada_em ? `<br>Última alteração: ${new Date(c.alterada_em).toLocaleDateString('pt-BR')}` : ''}</div>
      </form>` : ct ? `<form class="card pad" id="fc" style="display:flex;flex-direction:column;gap:12px">
        ${cab(ct.id ? 'Editando contador' : 'Novo contador', ct.id ? h(ct.nome) : 'Cadastrar contador')}
        ${ct.situacao === 'recusada' ? `<div class="msg err">A Sefaz recusou a senha ${quando(ct.ultimo_teste)}. Se ela mudou, atualize aqui.</div>` : ''}
        <label class="f">Nome<input name="nome" required value="${h(ct.nome)}"></label>
        <label class="f">CPF<input name="cpf" required inputmode="numeric" value="${h(ct.cpf)}" placeholder="000.000.000-00"></label>
        <label class="f">${ct.senha_secret_id ? 'Nova senha da Sefaz' : 'Senha da Sefaz'}<input name="senha" type="password" autocomplete="new-password" ${ct.senha_secret_id ? 'placeholder="Deixe em branco para manter a atual"' : 'required'}></label>
        <label class="chk"><input type="checkbox" id="verc">Mostrar senha</label>
        <button class="btn p" type="submit">Salvar contador</button>${cancelar}
        ${ct.id ? `<button type="button" class="btn del-o" id="excluirCont">Excluir contador</button>` : ''}
        <div class="sub">A senha fica criptografada. Depois de salva, ninguém consegue ver, só trocar.</div>
      </form>` : '<div class="card pad sub">Clique em <b>Editar</b> no contador que quer alterar (CPF e senha da Sefaz).</div>'}
    </div>` : ''}
    ${pcs.length ? `<section class="card tbl-wrap"><div class="pad" style="padding-bottom:8px"><h2>Computadores com a extensão</h2><div class="sub" style="margin-top:4px">Aparecem em "Baixar em". Exclua os que não usa mais. Ao remover a extensão do Chrome (versão 3.8.1 ou mais nova), o computador sai daqui sozinho.</div></div>
      <table class="tbl"><thead><tr><th>Computador</th><th>Situação</th><th>Último sinal</th><th>Versão</th><th></th></tr></thead><tbody>
      ${pcs.map(p => `<tr><td style="font-weight:600">${h(p.nome)}${p.id === meuPc() ? ' <span class="sub">(este)</span>' : ''}</td>
        <td>${p.verificacao_desde && pcOnline(p) ? '<span class="pill er">Parado na verificação</span>' : pcOnline(p) ? '<span class="pill ok">Online</span>' : '<span class="pill na">Offline</span>'}</td>
        <td>${quando(p.ultimo_sinal)}</td><td>${h(p.versao || '—')}</td>
        <td style="text-align:right">${eAdmin() ? `<button type="button" class="btn s del-o" data-tirar-pc="${p.id}">Excluir</button>` : ''}</td></tr>`).join('')}
      </tbody></table></section>` : ''}`);
  $$('tr.click').forEach(tr => tr.onclick = () => go(tr.dataset.href));
  $$('[data-cancelar]').forEach(bt => bt.onclick = () => go('#/acesso?esc=' + selId));
  $$('[data-tirar-pc]').forEach(bt => bt.onclick = async () => {
    if (await excluirPc(pcs.find(p => p.id === bt.dataset.tirarPc))) telaAcesso(params);
  });
  if ($('#fc')) {
    $('#verc').onchange = e => { $('#fc [name=senha]').type = e.target.checked ? 'text' : 'password'; };
    $('#fc').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const novoId = await q(sb.rpc('salvar_contador', { p_escritorio: selId, p_id: ct.id || null, p_nome: fd.get('nome').trim(), p_cpf: fd.get('cpf').replace(/\D/g, ''), p_senha: fd.get('senha') || null }));
      limparCache(); toast('Contador salvo.'); go(qsCont(novoId));
    };
    if ($('#excluirCont')) $('#excluirCont').onclick = async () => {
      if (!confirm(`Excluir o contador ${ct.nome}? As ${nEmp[ct.id] || 0} empresas dele passam a usar o login do escritório.`)) return;
      await q(sb.from('contadores').delete().eq('id', ct.id));
      limparCache(); toast('Contador excluído.'); go('#/acesso?esc=' + selId);
    };
  }
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
  // Só a extensão do Chrome: o organizador (scripts do Windows) é baixado à parte, senão o Windows Defender estranha o zip.
  const arquivos = (arv.tree || []).filter(t => t.type === 'blob' && t.path.startsWith('extensao/') && !t.path.startsWith('extensao/organizador/') && !/credenciais\.json$/.test(t.path));
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
// Organizador de pastas (Windows): pasta organizador/ do GitHub, na versão mais nova.
async function baixarOrganizador() {
  const arv = await fetch(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`)
    .then(r => r.ok ? r.json() : Promise.reject(new Error('GitHub não respondeu (' + r.status + ')')));
  const arquivos = (arv.tree || []).filter(t => t.type === 'blob' && t.path.startsWith('organizador/'));
  if (!arquivos.length) throw new Error('organizador não encontrado no GitHub');
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = new JSZip();
  await Promise.all(arquivos.map(async a => {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${a.path}`);
    if (!r.ok) throw new Error('falhou ao baixar ' + a.path);
    zip.file('organizador-automacao-notas/' + a.path.slice('organizador/'.length), await r.arrayBuffer());
  }));
  const blob = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'organizador-automacao-notas.zip';
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
  const vez = ++st.vez;
  if (!eAdmin()) return go('#/');
  const [vers, pcs, logins] = await Promise.all([
    q(sb.from('extensao_versoes').select('*')),
    carregarPcs(),
    q(sb.from('extensao_login').select('email,alterado_em')),
  ]);
  vers.sort((a, b) => cmpVer(b.versao, a.versao));
  const princ = vers.find(v => v.principal) || vers[0], login = logins[0];
  const atras = pcs.filter(p => desatualizado(p, princ?.versao));
  const minhaExt = document.documentElement.dataset.automacaoNotas;   // versão da extensão neste Chrome (painel.js)
  const esteAtras = !!(princ && minhaExt && cmpVer(minhaExt, princ.versao) < 0);
  const outrosAtras = atras.filter(p => p.id !== meuPc());   // este computador já aparece na frase de cima
  await layout(vez, 'atualizacoes', `
    <div class="top"><div><div class="sub">Baixe a extensão do Chrome em qualquer computador</div><h1>Atualizações</h1></div></div>
    ${princ ? `<section class="card pad" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      <div style="width:52px;height:52px;border-radius:10px;background:var(--navy);display:flex;align-items:center;justify-content:center"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg></div>
      <div style="flex:1;min-width:260px"><div class="sub">Versão para instalar</div>
        <div style="font-size:28px;font-weight:700;margin-top:2px">${h(princ.versao)} <span class="pill ok" style="vertical-align:middle;margin-left:6px">Principal</span></div>
        <div class="sub" style="margin-top:4px">Publicada em ${dataBr(princ.publicada_em)} · ${h(princ.descricao || '')}. Só os arquivos da extensão do Chrome, já com o login do painel.</div></div>
      <button type="button" class="btn p" style="padding:0 22px" data-baixar="${h(princ.versao)}">Baixar extensão (.zip)</button>
    </section>` : '<div class="card empty">Nenhuma versão cadastrada.</div>'}
    <div class="sub" style="margin-top:-8px">Login dentro da extensão: ${login ? `<b>${h(login.email)}</b>` : '<b style="color:var(--err)">não configurado</b>'} · <a href="#" id="trocar-login">${login ? 'Alterar' : 'Configurar'}</a></div>
    ${(outrosAtras.length || esteAtras) ? `<div class="card" style="background:var(--warn-bg);border-color:#E9C46A;padding:14px 18px;color:var(--warn);font-size:14px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">
        ${esteAtras ? (cmpVer(minhaExt, '3.11.3') >= 0
          ? `<b>Este computador está na ${h(minhaExt)}; há a ${h(princ.versao)}.</b> Clique em Atualizar: abre a página da extensão; na primeira vez escolha a pasta da extensão, nas próximas é só clicar em <b>Atualizar agora</b>.`
          : `<b>Este computador está na ${h(minhaExt)}, que não tem o botão de atualizar.</b> Baixe a ${h(princ.versao)} aqui e substitua os arquivos uma última vez.`) : ''}
        ${outrosAtras.length ? `${esteAtras ? '<br>' : ''}<b>${outrosAtras.map(p => `${h(p.nome)} (${h(p.versao || 'sem versão')})`).join(', ')} ${outrosAtras.length > 1 ? 'ainda não atualizaram' : 'ainda não atualizou'}.</b> Atualize por esta tela (ou pelo ícone da extensão) em cada um deles.` : ''}
      </div>
      ${esteAtras && cmpVer(minhaExt, '3.11.3') >= 0 ? '<button type="button" class="btn p" style="padding:0 18px" id="atualizar-este">Atualizar este computador</button>' : ''}
    </div>` : ''}
    <div class="cols">
      <section class="card tbl-wrap"><div class="pad" style="padding-bottom:8px"><h2>Computadores com a extensão</h2><div class="sub" style="margin-top:4px">Versão que cada computador informou no último sinal. Ao remover a extensão do Chrome (3.8.1 ou mais nova), ele sai daqui sozinho.</div></div>
        ${pcs.length ? `<table class="tbl"><thead><tr><th>Computador</th><th>Situação</th><th>Último sinal</th><th>Versão</th><th class="c">Atualizada?</th><th></th></tr></thead><tbody>
        ${pcs.map(p => `<tr><td style="font-weight:600">${h(p.nome)}${p.id === meuPc() ? ' <span class="sub">(este)</span>' : ''}</td>
          <td>${p.verificacao_desde && pcOnline(p) ? '<span class="pill er">Parado na verificação</span>' : pcOnline(p) ? '<span class="pill ok">Online</span>' : '<span class="pill na">Offline</span>'}</td>
          <td>${quando(p.ultimo_sinal)}</td><td>${h(p.versao || '—')}</td>
          <td class="c">${desatualizado(p, princ?.versao) ? '<span class="pill warn">Desatualizado</span>' : '<span class="pill ok">Em dia</span>'}${p.atualizacao ? `<div class="sub" style="margin-top:4px;max-width:260px;white-space:normal;${/^Erro/.test(p.atualizacao) ? 'color:var(--err)' : ''}">${h(p.atualizacao)}</div>` : ''}</td>
          <td style="text-align:right"><button type="button" class="btn s del-o" data-tirar-pc="${p.id}">Excluir</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Nenhum computador com nome ainda. Dê um nome no ícone da extensão.</div>'}</section>
      <section class="card pad"><h2>Como instalar ou atualizar</h2>
        <ol style="font-size:14px;color:var(--ink2);padding-left:20px;margin:12px 0 0;line-height:1.7">
          <li>Baixe o zip e extraia numa pasta fixa.<div class="mono" style="margin:6px 0">Documentos\\extensao-sefaz</div></li>
          <li>Abra <b>chrome://extensions</b> e ligue o <b>Modo do desenvolvedor</b>.</li>
          <li><b>Primeira vez:</b> Carregar sem compactação → escolha a pasta.</li>
          <li><b>Atualizar (3.11.3 ou mais nova):</b> botão <b>Atualizar este computador</b> nesta tela (ou <b>Atualizar a extensão</b> no ícone dela). Na primeira vez, escolha a pasta da extensão; nas próximas é só clicar em <b>Atualizar agora</b>. Versões antigas: substitua os arquivos da pasta e clique em <b>recarregar</b> (↻).</li>
          <li>No ícone da extensão, dê um nome ao computador (ex.: PC-CASA).</li></ol></section>
    </div>
    <section class="card pad" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      <div style="width:52px;height:52px;border-radius:10px;background:#E8EDF4;display:flex;align-items:center;justify-content:center"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1F3864" stroke-width="2" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>
      <div style="flex:1;min-width:260px"><h2>Organizador de pastas</h2><div class="sub" style="margin-top:4px">Move os ZIPs da pasta Downloads para a pasta de cada empresa. Instale em cada computador que baixa notas: extraia e rode <b>INSTALAR-ORGANIZADOR.bat</b>. Não precisa baixar de novo quando a extensão atualizar.</div></div>
      <button type="button" class="btn o" style="padding:0 18px" id="baixar-org">Baixar organizador (.zip)</button>
    </section>
    <section class="card tbl-wrap"><div class="pad" style="padding-bottom:8px"><h2>Histórico de versões</h2><div class="sub" style="margin-top:4px">A versão principal não pode ser excluída; torne outra principal antes.</div></div>
      <table class="tbl"><thead><tr><th>Versão</th><th>Data</th><th>O que mudou</th><th></th></tr></thead><tbody>
      ${vers.map(v => `<tr><td style="font-weight:600">${h(v.versao)}${v.principal ? ' <span class="pill ok">Principal</span>' : ''}</td><td>${dataBr(v.publicada_em)}</td><td>${h(v.descricao || '')}</td>
        <td style="text-align:right;white-space:nowrap"><button type="button" class="btn s o" data-baixar="${h(v.versao)}">Baixar</button>
        ${v.principal ? '' : ` <button type="button" class="btn s" data-principal="${h(v.versao)}">Tornar principal</button> <button type="button" class="btn s del-o" data-excluir-ver="${h(v.versao)}">Excluir</button>`}</td></tr>`).join('')}
      </tbody></table></section>`);
  $('#trocar-login').onclick = async e => { e.preventDefault(); if (await pedirLoginExtensao(login?.email)) { toast('Login da extensão salvo.'); telaAtualizacoes(); } };
  const btAtu = $('#atualizar-este');
  if (btAtu) btAtu.onclick = () => {
    btAtu.disabled = true; btAtu.textContent = 'Abrindo…';
    const ouvir = e => {
      if (e.source !== window || e.data?.tipo !== 'automacao-notas:atualizar-resposta') return;
      window.removeEventListener('message', ouvir);
      toast(e.data.erro ? 'Não foi possível atualizar: ' + e.data.erro : e.data.msg);
      if (e.data.erro) { btAtu.disabled = false; btAtu.textContent = 'Atualizar este computador'; }
      else { btAtu.disabled = false; btAtu.textContent = 'Atualizar este computador'; }
    };
    window.addEventListener('message', ouvir);
    window.postMessage({ tipo: 'automacao-notas:atualizar' }, location.origin);
  };
  $$('[data-baixar]').forEach(bt => bt.onclick = async () => {
    const v = vers.find(x => x.versao === bt.dataset.baixar);
    if (!login && !await pedirLoginExtensao()) return;
    const txt = bt.textContent; bt.disabled = true; bt.textContent = 'Montando…';
    try { await montarZip(v); toast(`Extensão ${v.versao} baixada.`); if (!login) telaAtualizacoes(); }
    catch (er) { toast('Não foi possível baixar: ' + er.message); }
    finally { bt.disabled = false; bt.textContent = txt; }
  });
  $('#baixar-org').onclick = async e => {
    const bt = e.currentTarget, txt = bt.textContent; bt.disabled = true; bt.textContent = 'Montando…';
    try { await baixarOrganizador(); toast('Organizador baixado. Extraia e rode INSTALAR-ORGANIZADOR.bat.'); }
    catch (er) { toast('Não foi possível baixar: ' + er.message); }
    finally { bt.disabled = false; bt.textContent = txt; }
  };
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
  const vez = ++st.vez;
  const [es, rot, exes, pcs] = await Promise.all([
    q(sb.from('escritorios').select('id,nome,pc_padrao').eq('id', id).maybeSingle()),
    q(sb.from('rotinas').select('*').eq('escritorio_id', id).maybeSingle()),
    q(sb.from('execucoes').select('*').eq('escritorio_id', id).order('solicitada_em', { ascending: false }).limit(1)),
    carregarPcs(),
  ]);
  if (!es) return naoEncontrado('Escritório não encontrado', 'Abra a rotina pela página do escritório.');
  const r = rot || { frequencia: 'semanal', dia_mes: 1, dias_semana: [1, 2, 3, 4, 5], horario: '06:00', periodo: 'mes_anterior', pasta_destino: 'C:\\Notas', tentativas: 3, avisar_email: true, resumo_diario: true, avisar_whatsapp: false, ativa: true };
  const ult = exes[0];
  const dls = ult ? await todos(() => sb.from('downloads').select('*, empresas(razao_social,ie)').eq('execucao_id', ult.id).order('empresa_id').order('id')) : [];
  const nomePc = pcs.find(p => p.id === ult?.pc_id)?.nome;
  const EXE = { pendente: ['pe', 'Aguardando robô'], aguardando_pc: ['pe', 'Aguardando o ' + (nomePc || 'computador escolhido')], rodando: ['pe', nomePc ? 'Rodando no ' + nomePc : 'Rodando'], concluida: ['ok', 'Concluída'], com_erros: ['pe', 'Concluída com erros'], falhou: ['er', 'Falhou'] };
  await layout(vez, 'rotina', `
    <div class="top"><div><div class="sub"><a href="#/escritorio/${id}">${h(es.nome)}</a></div><h1>Rotina automática</h1></div><div class="filters">${seletorPc(es, pcs)}</div></div>
    <form id="f" class="cols" style="grid-template-columns:1fr 1fr">
      <section class="card pad" style="display:flex;flex-direction:column;gap:16px">
        <h2>Quando rodar</h2>
        <label class="chk"><input type="checkbox" name="ativa" ${r.ativa ? 'checked' : ''}>Rotina ligada</label>
        <div class="f">Frequência<div class="seg" role="group" aria-label="Frequência"><button type="button" data-freq="semanal" class="${(r.frequencia || 'semanal') === 'semanal' ? 'on' : ''}">Toda semana</button><button type="button" data-freq="mensal" class="${r.frequencia === 'mensal' ? 'on' : ''}">Uma vez por mês</button></div></div>
        <div class="f" id="blocoSemana">Dias da semana<div style="display:flex;gap:6px;flex-wrap:wrap">${DIAS.map((d, i) => `<button type="button" class="day ${r.dias_semana.includes(i) ? 'on' : ''}" data-dia="${i}" aria-pressed="${r.dias_semana.includes(i)}">${d}</button>`).join('')}</div></div>
        <div class="g2"><label class="f" id="blocoMes">Dia do mês<select name="dia_mes">${[...Array(28)].map((_, k) => `<option value="${k + 1}" ${r.dia_mes === k + 1 ? 'selected' : ''}>Dia ${k + 1}</option>`).join('')}<option value="31" ${r.dia_mes >= 29 ? 'selected' : ''}>Último dia do mês</option></select></label>
          <label class="f">Horário<input type="time" name="horario" value="${h(String(r.horario).slice(0, 5))}"></label></div>
        <div class="g2"><label class="f">Período das notas<select name="periodo"><option value="mes_anterior">Mês anterior</option><option value="mes_atual" ${r.periodo === 'mes_atual' ? 'selected' : ''}>Mês atual</option></select></label>
          <label class="f">Tentativas quando der erro<select name="tentativas">${[1, 2, 3, 5].map(x => `<option ${x === r.tentativas ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
        <div class="proxima" id="proxima"></div>
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
  // Frequência (toda semana / uma vez por mês) e o quadro "Próxima execução"
  let freq = r.frequencia || 'semanal';
  const pcRotina = () => { const v = $('#pc')?.value; return v || meuPc() || es.pc_padrao || null; };
  const nomeDoPc = pid => pcs.find(p => p.id === pid)?.nome;
  const proxima = () => {
    const f = $('#f'); const [hh, mm] = (f.horario.value || '06:00').split(':').map(Number);
    const dias = $$('[data-dia].on').map(b => +b.dataset.dia), dm = +f.dia_mes.value, agora = new Date();
    let d = null;
    if (freq === 'mensal') {
      for (let k = 0; k < 3 && !d; k++) {
        const base = new Date(agora.getFullYear(), agora.getMonth() + k, 1);
        const ult = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        const c = new Date(base.getFullYear(), base.getMonth(), Math.min(dm, ult), hh, mm);
        if (c > agora) d = c;
      }
    } else if (dias.length) {
      for (let k = 0; k < 8 && !d; k++) { const c = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + k, hh, mm); if (dias.includes(c.getDay()) && c > agora) d = c; }
    }
    const box = $('#proxima');
    if (!f.ativa.checked) { box.innerHTML = 'Rotina desligada: não roda sozinha.'; return; }
    if (!d) { box.innerHTML = 'Escolha pelo menos um dia da semana.'; return; }
    const comp = new Date(d.getFullYear(), d.getMonth() - (f.periodo.value === 'mes_atual' ? 0 : 1), 1);
    const pid = pcRotina(), nome = nomeDoPc(pid);
    box.innerHTML = `Próxima execução: <b>${DIAS[d.getDay()].toLowerCase()}, ${d.toLocaleDateString('pt-BR')} às ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}</b>${nome ? ` no computador <b>${h(nome)}</b>` : ''} — baixa as notas de <b>${compNome(iso(comp))}</b> de todas as empresas.<br>`
      + (nome ? 'O computador precisa estar ligado e com o Chrome aberto nesse horário; se estiver desligado, roda assim que ligar.'
              : '<b>Nenhum computador com nome:</b> dê um nome no ícone da extensão do computador que vai baixar e escolha ele em "Baixar em".');
  };
  const mostrarFreq = () => {
    $$('[data-freq]').forEach(b => { b.classList.toggle('on', b.dataset.freq === freq); b.setAttribute('aria-pressed', b.dataset.freq === freq); });
    $('#blocoSemana').hidden = freq !== 'semanal'; $('#blocoMes').hidden = freq !== 'mensal'; proxima();
  };
  $$('[data-freq]').forEach(b => b.onclick = () => { freq = b.dataset.freq; mostrarFreq(); });
  $$('[data-dia]').forEach(bt => bt.onclick = () => { bt.classList.toggle('on'); bt.setAttribute('aria-pressed', bt.classList.contains('on')); proxima(); });
  $('#f').addEventListener('change', proxima);
  ligarSeletorPc(id);
  if ($('#pc')) $('#pc').addEventListener('change', proxima);
  mostrarFreq();
  $('#agora').onclick = async () => { await pedirExecucao(id); telaRotina(id); };
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await q(sb.from('rotinas').upsert({
      escritorio_id: id, ativa: fd.has('ativa'), frequencia: freq, dia_mes: +fd.get('dia_mes'), dias_semana: $$('[data-dia].on').map(b => +b.dataset.dia),
      horario: fd.get('horario'), periodo: fd.get('periodo'), tentativas: +fd.get('tentativas'), pasta_destino: fd.get('pasta_destino'),
      avisar_email: fd.has('avisar_email'), resumo_diario: fd.has('resumo_diario'), avisar_whatsapp: fd.has('avisar_whatsapp'),
      atualizada_em: new Date().toISOString(),
    }));
    // A rotina roda no computador escolhido em "Baixar em" (também quando é "Este computador").
    const pid = pcRotina();
    if (pid && eAdmin() && pid !== es.pc_padrao) { await q(sb.from('escritorios').update({ pc_padrao: pid }).eq('id', id)); es.pc_padrao = pid; }
    toast(pid ? `Rotina salva. Vai rodar no ${nomeDoPc(pid) || 'computador escolhido'}.` : 'Rotina salva. Falta um computador com nome para ela rodar sozinha.');
  };
}

function naoEncontrado(titulo, texto) {
  const vez = ++st.vez;
  return layout(vez, '', `<div class="card pad" style="max-width:520px;display:flex;flex-direction:column;gap:12px"><h2>${h(titulo)}</h2><div class="sub">${h(texto)}</div>
    <a class="btn p lk" href="${eAdmin() ? '#/escritorios' : '#/'}" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none">Voltar</a></div>`);
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
  st.reexibir = null;
  mostrarCarregando();
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const p = path.split('/').filter(Boolean);
  try {
    if (!p.length) return await telaPainel();
    if (p[0] === 'entregas') return await telaEntregas({ esc: params.get('esc') || '', mostrar: params.get('mostrar') || 'todas', busca: params.get('busca') || '' });
    if (p[0] === 'escritorios') return await telaEscritorios();
    if (p[0] === 'escritorio' && p[1]) { if (params.has('f')) (st.fEsc[p[1]] = st.fEsc[p[1]] || { q: '' }).chip = params.get('f'); return await telaEscritorio(p[1], params.get('aba') || 'empresas'); }
    if (p[0] === 'empresa' && p[1]) return await telaEmpresa(p[1], params);
    if (p[0] === 'alertas') return await telaAlertas();
    if (p[0] === 'acesso') return await telaAcesso(params);
    if (p[0] === 'atualizacoes') return await telaAtualizacoes();
    if (p[0] === 'rotina' && p[1]) return await telaRotina(p[1]);
    go('#/');
  } catch (e) {
    if (e === CANCELADA) return;
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
  if (evento === 'SIGNED_IN' && st.perfil && st.perfil.user_id === session?.user?.id && root.querySelector('.app')) return;   // voltar para a aba não recarrega a tela
  if (st.reautenticando && evento === 'SIGNED_IN') return; // conferência de senha na exclusão: não recarrega a tela
  if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(evento)) setTimeout(rota, 0);
});
