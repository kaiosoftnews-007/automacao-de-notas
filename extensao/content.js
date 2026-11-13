// Automação de Notas — roda dentro da tela "Baixar XML NFE" (nfeweb.sefaz.go.gov.br).
// Para cada empresa do painel: preenche, espera a verificação da Sefaz concluir, pesquisa,
// pede o download e depois busca os ZIPs no Histórico. Registra tudo no painel.
// A verificação "Confirme que é humano" NUNCA é clicada nem contornada: se ela pedir um
// clique, a extensão avisa e espera a pessoa.
(() => {
  if (window.__automacaoNotas) return;
  window.__automacaoNotas = true;

  const CONSULTA = 'https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfe/consulta-notas-recebidas';
  const ESPERA_VERIFICACAO = 10 * 60e3, ESPERA_RESULTADO = 40e3, PAUSA = 3000, MAX_HIST = 30;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const visivel = e => !!(e && (e.offsetParent || e.getClientRects().length));
  const texto = () => document.body?.innerText || '';
  const bg = m => new Promise((ok, err) => chrome.runtime.sendMessage(m, r => r?.erro ? err(new Error(r.erro)) : ok(r?.ok)));
  const ler = async () => (await chrome.storage.local.get('exec')).exec || null;
  const gravar = exec => chrome.storage.local.set({ exec });
  const limpo = t => String(t).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const so = t => String(t || '').replace(/\D/g, '');
  let st = null, ocupado = false;

  // ---------------------------------------------------------------- painel do site (best-effort)
  async function banco(item, dados) {
    try {
      if (!item.dl) {
        const r = await bg({ tipo: 'api', metodo: 'POST', caminho: 'downloads', prefer: 'return=representation',
          corpo: { empresa_id: item.empresa_id, escritorio_id: st.escritorio.id, execucao_id: st.execucao_id || null, competencia: st.comp, tipo: item.tipo, status: 'processando', ...dados } });
        item.dl = r[0].id;
      } else {
        await bg({ tipo: 'api', metodo: 'PATCH', caminho: `downloads?id=eq.${item.dl}`, corpo: { ...dados, atualizado_em: new Date().toISOString() } });
      }
      st.avisoBanco = null;
    } catch (e) {
      st.avisoBanco = /42501|row-level|permission/i.test(e.message)
        ? 'O painel recusou o registro: falta rodar o SQL 0003 no Supabase.' : 'Painel não atualizado: ' + e.message;
    }
  }

  // ---------------------------------------------------------------- interface
  const CORES = { pendente: '#5A6678', consultando: '#B8901F', pedindo: '#B8901F', pedido: '#1F3864', baixado: '#17804A', sem_notas: '#17804A', erro: '#B3261E' };
  const NOMES = { pendente: 'aguardando', consultando: 'consultando', pedindo: 'pedindo', pedido: 'na fila da Sefaz', baixado: 'baixado', sem_notas: 'sem notas', erro: 'erro' };
  let caixa;

  function montar() {
    if (caixa) return;
    caixa = document.createElement('div');
    caixa.style.cssText = 'position:fixed;top:8px;right:8px;width:340px;max-height:92vh;overflow:auto;z-index:2147483647;background:#fff;border:2px solid #1F3864;border-radius:8px;font:13px Arial;color:#172033;box-shadow:0 4px 16px #0004;padding:10px';
    caixa.innerHTML = `
      <div style="font-weight:bold;color:#1F3864">Automação de Notas</div>
      <div id="an-topo" style="margin:4px 0"></div>
      <div id="an-msg" style="margin:6px 0;padding:6px;background:#F3F5F8;border-radius:4px"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button id="an-iniciar" style="flex:1;padding:7px;background:#1F3864;color:#fff;border:0;border-radius:4px;cursor:pointer">Iniciar</button>
        <button id="an-pausar" style="padding:7px">Pausar</button>
        <button id="an-erros" style="padding:7px">Refazer erros</button>
      </div>
      <div style="margin-top:6px"><input id="an-ie" placeholder="Testar só uma IE (opcional)" style="width:100%;box-sizing:border-box;padding:5px"></div>
      <div id="an-lista" style="margin-top:8px;font-size:12px"></div>
      <button id="an-diag" style="margin-top:6px;font-size:11px">Copiar diagnóstico</button>`;
    document.body.appendChild(caixa);
    $('#an-iniciar', caixa).onclick = iniciar;
    $('#an-pausar', caixa).onclick = async () => { if (!st) return; st.rodando = !st.rodando; await gravar(st); st.rodando ? (location.href = st.urlForm) : dizer('Pausado.'); };
    $('#an-erros', caixa).onclick = async () => {
      if (!st) return;
      st.fila.forEach(i => { if (i.etapa === 'erro') { i.etapa = 'pendente'; i.msg = ''; i.clicou = false; } });
      Object.assign(st, { fase: 'consultas', rodando: true, voltas: 0 }); await gravar(st); irForm();
    };
    $('#an-diag', caixa).onclick = async () => {
      const d = [`URL: ${location.href}`, `Estado: ${JSON.stringify({ ...st, fila: st?.fila?.map(i => `${i.ie}/${i.tipo}/${i.etapa}/${i.msg || ''}`) })}`,
        'Campos: ' + $$('input,select,button,a[href],form').filter(e => e.id || e.name).map(e => `${e.tagName}#${e.id}[${e.name || ''}]`).join(' '),
        'Botões: ' + $$('button,a,input[type=button],input[type=submit]').map(e => (e.innerText || e.value || '').trim()).filter(Boolean).slice(0, 60).join(' | '),
        'Tabela: ' + $$('table tr').slice(0, 8).map(t => t.innerText.replace(/\s+/g, ' ')).join(' || '),
        'Texto: ' + texto().replace(/\s+/g, ' ').slice(0, 1500)].join('\n');
      await navigator.clipboard.writeText(d); dizer('Diagnóstico copiado. Cole na conversa com o Claude.');
    };
  }

  function dizer(msg) { if (st) st.msg = msg; desenhar(msg); }

  function desenhar(msg) {
    if (!caixa) return;
    const f = st?.fila || [], c = e => f.filter(i => i.etapa === e).length;
    $('#an-topo', caixa).innerHTML = st
      ? `${st.escritorio.nome} · competência <b>${st.comp.slice(5, 7)}/${st.comp.slice(0, 4)}</b><br>${c('baixado')} baixados · ${c('sem_notas')} sem notas · ${c('pedido')} na fila · ${c('erro')} erros · ${c('pendente')} a fazer`
      : 'Clique em Iniciar para buscar as empresas do painel.';
    $('#an-msg', caixa).textContent = (msg ?? st?.msg ?? '') + (st?.avisoBanco ? ' ⚠ ' + st.avisoBanco : '');
    $('#an-pausar', caixa).textContent = st?.rodando ? 'Pausar' : 'Continuar';
    $('#an-lista', caixa).innerHTML = f.map(i => `<div style="border-top:1px solid #DDE3EA;padding:2px 0"><span style="color:${CORES[i.etapa]}">●</span> ${i.nome} · ${i.tipo}${i.n != null ? ` · ${i.n}` : ''} — <span style="color:${CORES[i.etapa]}">${NOMES[i.etapa]}</span>${i.msg ? `<br><small>${i.msg}</small>` : ''}</div>`).join('');
  }

  // ---------------------------------------------------------------- início
  async function execucao(dados) {
    if (!st?.execucao_id) return;
    try { await bg({ tipo: 'api', metodo: 'PATCH', caminho: `execucoes?id=eq.${st.execucao_id}`, corpo: dados }); } catch (_) {}
  }

  async function iniciar(execucao_id = null) {
    if (typeof execucao_id !== 'string') execucao_id = null;
    try {
      const { sessao, escritorio } = await chrome.storage.local.get(['sessao', 'escritorio']);
      if (!sessao || !escritorio) return dizer('A extensão ainda não tem o login do painel: abra o painel (automacao-de-notas) neste Chrome, aperte F5 lá e depois clique em Iniciar aqui.');
      if (!$('#cmpNumIeDest')) return dizer('Abra a tela "Baixar XML NFE" (com os campos de período e inscrição) e clique em Iniciar de novo.');
      dizer('Buscando as empresas no painel...');
      const ie = so($('#an-ie', caixa).value);
      const emps = await bg({ tipo: 'api', caminho: `empresas?select=*&escritorio_id=eq.${escritorio.id}&ativa=eq.true&ie=not.is.null&order=razao_social${ie ? `&ie=eq.${ie}` : ''}` });
      const rot = (await bg({ tipo: 'api', caminho: `rotinas?select=periodo,pasta_destino&escritorio_id=eq.${escritorio.id}` }))[0];
      const h = new Date(), atual = rot?.periodo === 'mes_atual';
      const ini = new Date(h.getFullYear(), h.getMonth() - (atual ? 0 : 1), 1);
      const fim = atual ? h : new Date(h.getFullYear(), h.getMonth(), 0);
      const br = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      const fila = [];
      for (const e of emps) for (const tipo of ['entrada', 'saida']) {
        if (!e[`baixar_${tipo}`] || !so(e.ie)) continue;
        fila.push({ empresa_id: e.id, ie: so(e.ie), nome: e.razao_social,
          pastaEmpresa: (e.pasta || '').replace(/[\\/]+$/, ''), codigo: e.codigo || '',
          mae: (rot?.pasta_destino || 'C:\\Notas').replace(/[\\/]+$/, ''),
          tipo, modelo: e.modelo, canceladas: e.exibir_canceladas, eventos: e.incluir_eventos, etapa: 'pendente' });
      }
      if (!fila.length) return dizer(ie ? `Não achei empresa ativa com a IE ${ie} nesse escritório.` : 'Nenhuma empresa ativa com inscrição estadual nesse escritório.');
      st = { rodando: true, fase: 'consultas', escritorio, ini: br(ini), fim: br(fim),
        comp: `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}-01`, urlForm: location.href, fila, tentHist: 0, voltas: 0, execucao_id };
      await gravar(st);
      await execucao({ status: 'rodando', iniciada_em: new Date().toISOString() });
      passo();
    } catch (e) { dizer('Não consegui começar: ' + e.message); }
  }

  // ---------------------------------------------------------------- navegação
  async function irForm(espera = PAUSA) { await gravar(st); desenhar(); await dorme(espera); location.href = st.urlForm; }

  async function esperarVerificacao(seletorForm) {
    const campo = () => $(`${seletorForm} [name="cf-turnstile-response"]`) || $('[name="cf-turnstile-response"]');
    const t0 = Date.now(); let avisou = false;
    while (Date.now() - t0 < ESPERA_VERIFICACAO) {
      if (!(await ler())?.rodando) return false;
      if (campo()?.value) return true;
      if (!avisou && Date.now() - t0 > 30e3) {
        avisou = true; dizer('A Sefaz pediu a verificação. Clique na caixinha "Confirme que é humano" que eu continuo.');
        bg({ tipo: 'avisar', texto: 'A Sefaz pediu a verificação "Confirme que é humano". Clique na caixinha para continuar.' }).catch(() => {});
      }
      await dorme(1000);
    }
    return false;
  }

  function setar(sel, valor) {
    const e = $(sel); if (!e) throw new Error(`campo ${sel} não encontrado na tela`);
    e.value = valor; ['input', 'change', 'blur'].forEach(t => e.dispatchEvent(new Event(t, { bubbles: true })));
  }

  const porTexto = (re, sel = 'button,a,input[type=button],input[type=submit],label,span,li,div') =>
    $$(sel).filter(e => visivel(e) && !caixa.contains(e) && re.test((e.innerText || e.value || '').trim()))
      .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);

  const clicar = async el => { $$('[data-an-clicar]').forEach(x => x.removeAttribute('data-an-clicar'));
    el.setAttribute('data-an-clicar', '1'); await bg({ tipo: 'clicar' }).catch(() => el.click()); };

  // ---------------------------------------------------------------- consultas
  async function falhar(item, msg) { item.etapa = 'erro'; item.msg = msg; await banco(item, { status: 'erro', mensagem: msg.slice(0, 400) }); return irForm(); }

  async function preencherEPesquisar(item) {
    if (!/^\d{9}$/.test(item.ie)) return falhar(item, `Inscrição estadual ${item.ie} inválida: em Goiás ela tem 9 números. Corrija no cadastro da empresa.`);
    setar('#cmpDataInicial', st.ini); setar('#cmpDataFinal', st.fim); setar('#cmpNumIeDest', item.ie);
    const radio = $(`input[name=cmpTipoNota][value="${item.tipo === 'entrada' ? 0 : 1}"]`);
    if (!radio) throw new Error('opção Entrada/Saída não encontrada na tela');
    radio.click();
    if ($('#cmpModelo')) setar('#cmpModelo', { todos: '-', 55: '55', 65: '65' }[item.modelo] || '-');
    if ($('#cmpExbNotasCanceladas')) setar('#cmpExbNotasCanceladas', item.canceladas ? '2' : '1');
    item.etapa = 'consultando'; item.clicou = false; item.t0 = Date.now();
    await banco(item, { status: 'processando' }); await gravar(st);
    dizer(`${item.nome} · ${item.tipo}: aguardando a verificação da Sefaz...`);
    if (!(await esperarVerificacao('#filtro'))) return dizer((await ler())?.rodando ? 'Ninguém clicou na verificação em 10 min. Clique em Continuar quando puder.' : 'Pausado.');
    const b = $('#btnPesquisar'); if (!b) throw new Error('botão Pesquisar não encontrado');
    item.clicou = true; await gravar(st); dizer(`${item.nome} · ${item.tipo}: consultando...`);
    await clicar(b);
    await dorme(4000); lerResultado(item);     // se a tela não recarregar, lê daqui mesmo
  }

  async function lerResultado(item) {
    const t0 = Date.now();
    while (Date.now() - t0 < ESPERA_RESULTADO) {
      const t = texto(), m = t.match(/Total de notas:\s*(\d+)/i);
      if (m && +m[1] > 0) { item.n = +m[1]; return pedirDownload(item); }
      if (m || /nenhum[a]? (nota|registro|resultado)|n[ãa]o (foram )?encontrad/i.test(t)) {
        item.etapa = 'sem_notas'; item.n = 0; await banco(item, { status: 'sem_notas', qtd_notas: 0, mensagem: null }); return irForm();
      }
      await dorme(1500);
    }
    const aviso = $$('.alert,.erro,.error,.msg,.mensagem,.text-danger,.invalid-feedback,[role=alert]')
      .filter(e => visivel(e) && !caixa.contains(e)).map(e => e.innerText.trim()).filter(Boolean).join(' | ');
    return falhar(item, aviso ? 'A Sefaz respondeu: ' + aviso.slice(0, 200)
      : 'A Sefaz voltou para o formulário sem mostrar o resultado. Confira a inscrição estadual da empresa.');
  }

  async function pedirDownload(item) {
    const todos = porTexto(/Baixar todos os arquivos/i, 'button,a,input[type=button],input[type=submit]')[0];
    if (!todos) return falhar(item, `Achei ${item.n} nota(s), mas não o botão "Baixar todos os arquivos".`);
    await clicar(todos); await dorme(1200);
    const opcao = porTexto(item.eventos ? /Baixar documentos e eventos/i : /Baixar somente documentos/i)[0];
    if (opcao) { (opcao.htmlFor ? document.getElementById(opcao.htmlFor) : $('input', opcao) || opcao).click(); await dorme(600); }
    const baixar = porTexto(/^Baixar$/i, 'button,a,input[type=button],input[type=submit]').pop();
    if (!baixar) return falhar(item, 'Não achei o botão "Baixar" para confirmar o pedido.');
    item.etapa = 'pedindo'; item.pedidoEm = Date.now(); await gravar(st);
    await clicar(baixar); await dorme(5000);
    return pedido(item);                         // se a tela recarregar antes, o passo() faz isto
  }

  async function pedido(item) {
    item.etapa = 'pedido'; item.pedidoEm = item.pedidoEm || Date.now(); await banco(item, { status: 'fila', qtd_notas: item.n, mensagem: 'Na fila da Sefaz' }); return irForm();
  }

  // ---------------------------------------------------------------- histórico
  async function historico() {
    const linhas = $$('table tbody tr').filter(tr => !caixa.contains(tr));
    if (!st.histAberto && $('#btnHistoricoDownload')) {
      dizer('Abrindo o Histórico de Downloads (aguardando a verificação)...');
      if (!(await esperarVerificacao('#historicoDownload'))) return dizer('Aguardando alguém clicar na verificação. Depois clique em Continuar.');
      st.histAberto = true; await gravar(st); await clicar($('#btnHistoricoDownload'));
      await dorme(6000); return historico();
    }
    st.histAberto = false;
    const usadas = new Set(), pend = () => st.fila.filter(i => i.etapa === 'pedido');
    for (const item of pend()) {
      let cand = linhas.filter(tr => !usadas.has(tr) && so(tr.innerText).includes(item.ie));
      const doTipo = cand.filter(tr => (item.tipo === 'entrada' ? /entrada/i : /sa[ií]da/i).test(tr.innerText));
      if (doTipo.length) cand = doTipo;
      // O nome do ZIP não diz se é entrada ou saída: escolhe a linha com o horário mais perto do pedido.
      const quando = tr => { const m = tr.innerText.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
        return m ? new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +m[6]).getTime() : null; };
      cand = cand.filter(tr => { const q = quando(tr); return q == null || !item.pedidoEm || q >= item.pedidoEm - 5 * 60e3; });
      cand.sort((a, b) => Math.abs((quando(a) ?? 0) - (item.pedidoEm || 0)) - Math.abs((quando(b) ?? 0) - (item.pedidoEm || 0)));
      const tr = cand[0]; if (!tr) continue;
      const link = $('a[href*="download" i],a[href],button:not([disabled])', tr);
      if (/processando|em process|aguard|fila|pendente/i.test(tr.innerText) || !link) continue;
      usadas.add(tr);
      if (/erro|falh|expirad/i.test(tr.innerText)) { item.etapa = 'erro'; item.msg = 'A Sefaz não gerou o arquivo: ' + tr.innerText.replace(/\s+/g, ' ').slice(0, 100); await banco(item, { status: 'erro', mensagem: item.msg }); continue; }
      const mmaaaa = st.comp.slice(5, 7) + st.comp.slice(0, 4);   // ex.: 102026
      // O Chrome só salva em Downloads: o ZIP vai para Notas Sefaz\_organizar com um .destino.txt ao lado,
      // e o organizador do Windows move para a pasta da empresa.
      // Sem pasta no cadastro, o organizador procura dentro da pasta mãe uma pasta com o código ou o nome
      // da empresa; se não achar, cria "código - nome".
      const nomeArq = `${mmaaaa}\\${item.tipo === 'entrada' ? 'Entrada' : 'Saida'}_${mmaaaa}.zip`;
      const final = item.pastaEmpresa ? `${item.pastaEmpresa}\\${nomeArq}`
        : `${item.mae}\\${limpo(item.codigo ? `${item.codigo} - ${item.nome}` : item.nome)}\\${nomeArq}`;
      const arq = `Notas Sefaz/_organizar/${item.ie}_${item.tipo}_${mmaaaa}.zip`;
      const guia = [`pasta=${item.pastaEmpresa}`, `mae=${item.mae}`, `codigo=${item.codigo}`, `nome=${item.nome}`, `arquivo=${nomeArq}`].join('\r\n');
      await bg({ tipo: 'gravarDestino', nome: arq + '.destino.txt', texto: guia });
      await bg({ tipo: 'nomeDownload', nome: arq });
      item.etapa = 'baixado'; await gravar(st);
      await banco(item, { status: 'concluido', qtd_notas: item.n, arquivo: final, mensagem: null });
      dizer(`Baixando ${item.nome} · ${item.tipo}...`);
      await clicar(link); await dorme(5000);
    }
    if (!pend().length) return concluir();
    if (++st.tentHist > MAX_HIST) {
      for (const i of pend()) { i.etapa = 'erro'; i.msg = linhas.length ? 'O arquivo não ficou pronto na fila da Sefaz.' : 'Não consegui ler o Histórico de Downloads.'; await banco(i, { status: 'erro', mensagem: i.msg }); }
      return concluir();
    }
    dizer(`${pend().length} arquivo(s) ainda na fila da Sefaz. Olho de novo em 1 minuto (${st.tentHist}/${MAX_HIST}).`);
    return irForm(60e3);
  }

  async function concluir() {
    st.rodando = false; const c = e => st.fila.filter(i => i.etapa === e).length;
    await execucao({ status: !c('erro') ? 'concluida' : (c('erro') < st.fila.length ? 'com_erros' : 'falhou'), finalizada_em: new Date().toISOString() });
    dizer(`Terminou: ${c('baixado')} baixados, ${c('sem_notas')} sem notas, ${c('erro')} com erro. Os ZIPs vão para a pasta de cada empresa.`);
    await gravar(st); bg({ tipo: 'avisar', texto: st.msg }).catch(() => {});
  }

  // ---------------------------------------------------------------- motor
  async function passo() {
    if (ocupado) return; ocupado = true;
    try {
      st = await ler(); montar(); desenhar();
      if (!st?.rodando) return;
      if (/requer nova autentica/i.test(texto())) return dizer('A Sefaz pediu a senha de novo. Digite, autentique e abra "Baixar XML NFE" — eu continuo de onde parei.');
      if (st.fase === 'historico') return await historico();

      const f = st.fila;
      let item = f.find(i => i.etapa === 'pedindo'); if (item) return await pedido(item);
      item = f.find(i => i.etapa === 'consultando');
      if (item && item.clicou) return await lerResultado(item);
      if (item) item.etapa = 'pendente';
      item = f.find(i => i.etapa === 'pendente');
      if (!item) {
        if (!f.some(i => i.etapa === 'pedido')) return await concluir();
        st.fase = 'historico'; st.histAberto = false; return await irForm();
      }
      if (!$('#cmpNumIeDest')) {
        if (++st.voltas > 3) { st.rodando = false; await gravar(st); return dizer('Não encontrei a tela de consulta. Abra "Baixar XML NFE" e clique em Continuar.'); }
        if (st.voltas === 2) st.urlForm = CONSULTA;
        return await irForm();
      }
      st.voltas = 0;
      try { await preencherEPesquisar(item); } catch (e) { await falhar(item, e.message); }
    } catch (e) { dizer('Erro: ' + e.message); }
    finally { ocupado = false; if (st) gravar(st); }
  }

  // Só age na tela da consulta (ou no meio de uma execução).
  setTimeout(async () => {
  // Pedido do painel que veio no endereço da aba (#automacao=...)
    try {
      const mh = location.hash.match(/automacao=([^&]+)/);
      if (mh) {
        const p = JSON.parse(decodeURIComponent(mh[1]));
        await chrome.storage.local.set({ pedido: { ...p, em: Date.now() }, login: {}, idas: {} });
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch (_) {}
    const { pedido } = await chrome.storage.local.get('pedido');
    for (let i = 0; i < 20 && pedido && !$('#cmpNumIeDest'); i++) await dorme(1000);
    if (pedido && Date.now() - pedido.em < 60 * 60e3 && $('#cmpNumIeDest') && !(await ler())?.rodando) {
      await chrome.storage.local.set({ login: {}, idas: {} });
      await chrome.storage.local.set({ pedido: null });   // pedido do botão "Baixar" do painel
      const { escritorio } = await chrome.storage.local.get('escritorio');
      if (escritorio?.id !== pedido.escritorio_id) {
        let esc = { id: pedido.escritorio_id, nome: 'Escritório' };
        try { esc = (await bg({ tipo: 'api', caminho: `escritorios?select=id,nome&id=eq.${pedido.escritorio_id}` }))[0] || esc; } catch (_) {}
        await chrome.storage.local.set({ escritorio: esc });
      }
      montar(); $('#an-ie', caixa).value = pedido.ie || ''; return iniciar(pedido.execucao_id);
    }
    if ($('#cmpNumIeDest') || $('#btnHistoricoDownload') || (await ler())?.rodando) passo();
  }, 600);
})();
