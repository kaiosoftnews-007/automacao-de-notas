// 3.13.0 — Sefaz DF (Agênci@Net / DEC). Roda só na aba do Agênci@Net que a extensão abriu.
// 1) Solicita os XMLs (NF-e e NFC-e, Emitente e Destinatário) pelo CNPJ de cada empresa DF do painel.
// 2) Nas voltas seguintes (a cada 5 min), baixa os pacotes que o DF já deixou "Concluído".
// A verificação da Cloudflare NUNCA é clicada pela extensão: se ela pedir clique, a extensão avisa e espera.
(() => {
  if (window.__anDf) return;
  window.__anDf = true;

  const DEC = 'https://www2.agencianet.fazenda.df.gov.br/DEC/#/';
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const bg = m => new Promise((ok, err) => chrome.runtime.sendMessage(m, r => {
    if (chrome.runtime.lastError) return err(new Error(chrome.runtime.lastError.message));
    r?.erro ? err(new Error(r.erro)) : ok(r?.ok);
  }));
  const pag = (acao, arg) => bg({ tipo: 'dfPagina', acao, arg });
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ');

  async function rodar() {
    if (!(await bg({ tipo: 'dfMinhaAba' }).catch(() => false))) return;   // aba aberta por você: não mexe
    if (!location.pathname.toUpperCase().startsWith('/DEC')) {
      // Já entrou (área restrita): vai para o DEC. Senão é a tela de login com certificado: avisa.
      await dorme(3000);
      if (/\/Inicio\/Restrita/i.test(location.pathname) || /área restrita do Portal/i.test(document.body?.innerText || '')) { location.href = DEC; return; }
      await dorme(20e3);
      return bg({ tipo: 'dfLogin' }).catch(() => {});
    }
    let e = null;
    for (let i = 0; i < 60; i++) { e = await pag('estado').catch(() => null); if (e?.pronto) break; await dorme(1000); }
    if (!e?.pronto) return bg({ tipo: 'dfLogin' }).catch(() => {});   // DEC não abriu: provavelmente pediu o login
    await bg({ tipo: 'dfOk' }).catch(() => {});
    await bg({ tipo: 'dfRodando' }).catch(() => {});
    try {
      await solicitarTodos();
      // 3.13.9: o DF costuma liberar em 1–2 min; confere mais 3 vezes, de minuto em minuto, antes de esperar a próxima volta.
      for (let k = 0; k < 4; k++) {
        await baixarProntos();
        const its = (await bg({ tipo: 'dfItens' })) || [];
        if (!its.some(i => i.estado === 'solicitado') || k === 3) break;
        await bg({ tipo: 'dfRodando' }).catch(() => {});
        await dorme(60e3);
      }
    } catch (er) { console.warn('DF:', er.message); }
    bg({ tipo: 'dfFim' }).catch(() => {});
  }

  async function esperarCaptcha() {
    const t0 = Date.now(); let avisou = false;
    while (Date.now() - t0 < 10 * 60e3) {
      if ((await pag('estado').catch(() => null))?.token) { if (avisou) bg({ tipo: 'dfOk' }).catch(() => {}); return true; }
      if (!avisou && Date.now() - t0 > 15e3) { avisou = true; bg({ tipo: 'dfVerificacao' }).catch(() => {}); }
      await dorme(1000);
    }
    return false;
  }

  // 3.13.7: relê a fila depois de cada rodada, para pegar empresas escolhidas no painel enquanto a volta já rodava.
  async function solicitarTodos() {
    for (let rodada = 0; rodada < 4; rodada++) {
      const pend = ((await bg({ tipo: 'dfItens' })) || []).filter(i => i.estado === 'a_solicitar');
      if (!pend.length) return;
      if (!(await solicitarLista(pend))) return;
    }
  }

  async function solicitarLista(itens) {
    for (const it of itens) {
      await bg({ tipo: 'dfRodando' }).catch(() => {});
      if (!(await esperarCaptcha())) return false;
      const r = await pag('solicitar', it).catch(er => ({ ok: false, msg: er.message }));
      const msg = r?.msg || 'sem resposta';
      const tent = (it.tent || 0) + 1;
      let patch;
      if (r?.ok || /j[áa] existe pedido anterior/i.test(msg)) patch = { estado: 'solicitado', solicitadoEm: Date.now(), msg: null };
      else if (/n[ãa]o foram encontrados documentos|n[ãa]o foi poss[íi]vel localizar arquivo/i.test(msg)) patch = { estado: 'sem_notas', msg: null };
      else if (/limite de solicita/i.test(msg)) {
        await bg({ tipo: 'dfMarcar', id: it.id, patch: { msg: 'Fila do DF cheia: peço de novo quando liberar espaço.' } });
        await pag('resetCaptcha'); return false;
      }
      else if (/permiss/i.test(msg)) patch = { estado: 'erro', msg: 'O certificado do escritório não tem procuração para esta empresa no DF (precisa do certificado próprio).' };
      else if (/credenciais/i.test(msg)) patch = { estado: 'erro', msg: 'O DF recusou o certificado (credenciais inválidas).' };
      else if (tent < 3) patch = { tent, msg: 'Tentativa ' + tent + ': ' + msg };
      else patch = { estado: 'erro', msg: 'O DF respondeu: ' + msg };
      await bg({ tipo: 'dfMarcar', id: it.id, patch });
      await pag('resetCaptcha');
      await dorme(2000);
    }
    return true;
  }

  const casa = (p, it) => {
    const c = norm(p.crit);
    return p.cnpj === it.cnpj && c.startsWith(it.mod + ' ') && c.includes(it.origem === 'D' ? 'DESTINAT' : 'EMITENTE')
      && c.includes(`DE ${it.ini} ATE ${it.fim}`);
  };

  async function baixarProntos() {
    let itens = (await bg({ tipo: 'dfItens' })) || [];
    if (!itens.some(i => i.estado === 'solicitado' || (i.estado === 'baixado' && !i.limpo))) return;
    const pac = await pag('pacotes').catch(er => ({ ok: false, msg: er.message }));
    if (!pac?.ok) { console.warn('DF pacotes:', pac?.msg); return; }
    await bg({ tipo: 'dfDiag', amostra: pac.bruto }).catch(() => {});
    for (const it of itens.filter(i => i.estado === 'solicitado')) {
      const p = pac.lista.find(x => casa(x, it));
      const idade = Date.now() - (it.solicitadoEm || 0);
      if (!p) {
        // Pedido não aparece na lista do DF: pede de novo (até 3 vezes).
        if (idade > 15 * 60e3) await bg({ tipo: 'dfMarcar', id: it.id, patch: (it.tent || 0) < 3
          ? { estado: 'a_solicitar', tent: (it.tent || 0) + 1, msg: 'O pedido sumiu da lista do DF; pedindo de novo.' }
          : { estado: 'erro', msg: 'O pedido não aparece na lista "Arquivos Solicitados" do DF.' } });
        continue;
      }
      if (!p.concl) {
        if (/erro|falh|cancel/i.test(p.situacao || '')) await bg({ tipo: 'dfMarcar', id: it.id, patch: { estado: 'erro', msg: 'O DF não gerou o arquivo: ' + p.situacao } });
        else if (idade > 3 * 24 * 3600e3) await bg({ tipo: 'dfMarcar', id: it.id, patch: { msg: 'Mais de 3 dias esperando o DF liberar o arquivo.' } });
        continue;
      }
      if (!(await pag('verificar', p.hash).catch(() => null))?.ok) continue;
      await bg({ tipo: 'dfBaixar', id: it.id, hash: p.hash });
      await dorme(4000);
      // 3.13.8: conta os XMLs do pacote (o DF não informa a quantidade) para o painel mostrar entrada/saída.
      const c = await pag('contar', p.hash).catch(() => null);
      if (c?.ok) await bg({ tipo: 'dfQtd', id: it.id, n: c.n }).catch(() => {});
    }
    // Tira da lista do DF o que já foi baixado há mais de 15 min (libera espaço na fila de pedidos).
    itens = (await bg({ tipo: 'dfItens' })) || [];
    for (const it of itens.filter(i => i.estado === 'baixado' && i.hash && !i.limpo && Date.now() - (i.baixadoEm || 0) > 15 * 60e3)) {
      await pag('cancelar', it.hash).catch(() => {});
      await bg({ tipo: 'dfMarcar', id: it.id, patch: { limpo: true } });
    }
  }

  setTimeout(rodar, 1500);
})();
