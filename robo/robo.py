"""
Robô da Automação de Notas
--------------------------
Fica rodando no computador do escritório. A cada minuto:
  1. avisa o painel que está online;
  2. cria as execuções agendadas (pela tela "Rotina automática" do site);
  3. pega a próxima execução pendente e, para cada empresa com IE, entra na Sefaz-GO,
     consulta as notas de entrada e de saída, pede o download, busca o ZIP no
     "Histórico de Downloads", descompacta na pasta e registra tudo no painel.

Usa o Google Chrome instalado no computador, com um perfil próprio (pasta perfil-chrome),
e mostra a janela. Se a Sefaz pedir a verificação "Confirme que é humano", o robô espera
alguém clicar (e avisa no painel) — ele não tenta burlar essa verificação.

Teste com uma empresa:  python robo.py --teste 202843025
"""
import argparse
import datetime as dt
import logging
import re
import shutil
import sys
import time
import traceback
import zipfile
from logging.handlers import RotatingFileHandler
from pathlib import Path
from zoneinfo import ZoneInfo
import os

import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, Error as PWError

VERSAO = '0.1.0'
BASE = Path(__file__).resolve().parent
load_dotenv(BASE / '.env')

SUPABASE_URL = os.getenv('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.getenv('SUPABASE_SECRET_KEY', '')
MAQUINA = os.getenv('MAQUINA') or os.getenv('COMPUTERNAME', 'pc')
ESPERA_VERIFICACAO_MIN = int(os.getenv('ESPERA_VERIFICACAO_MIN', '10'))
ESPERA_FILA_MIN = int(os.getenv('ESPERA_FILA_MIN', '30'))
TZ = ZoneInfo('America/Sao_Paulo')

PORTAL = 'https://portal.sefaz.go.gov.br/portalsefaz-apps/'
CONSULTA = 'https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfe/consulta-notas-recebidas'
DIAG = BASE / 'diagnostico'
PERFIL = BASE / 'perfil-chrome'

log = logging.getLogger('robo')


class LoginRecusado(Exception):
    pass


class SemVerificacao(Exception):
    pass


# ---------------------------------------------------------------- banco (Supabase REST)

S = requests.Session()


def db(metodo, tabela, params=None, dados=None, prefer=None):
    h = {'apikey': SUPABASE_KEY, 'Content-Type': 'application/json'}
    if prefer:
        h['Prefer'] = prefer
    r = S.request(metodo, f'{SUPABASE_URL}/rest/v1/{tabela}', params=params, json=dados, headers=h, timeout=30)
    if r.status_code >= 300:
        raise RuntimeError(f'Supabase {r.status_code}: {r.text[:300]}')
    return r.json() if r.text else None


def sel(tabela, **params):
    return db('GET', tabela, params=params)


def ins(tabela, dados):
    return db('POST', tabela, dados=dados, prefer='return=representation')


def upd(tabela, filtro, dados):
    return db('PATCH', tabela, params=filtro, dados=dados, prefer='return=minimal')


def ups(tabela, dados):
    return db('POST', tabela, dados=dados, prefer='resolution=merge-duplicates,return=minimal')


def rpc(funcao, args):
    return db('POST', f'rpc/{funcao}', dados=args)


def agora():
    return dt.datetime.now(TZ)


def iso(d=None):
    return (d or agora()).isoformat()


def alerta(escritorio, tipo, titulo, detalhe=None, empresa=None, acao=None):
    try:
        ins('alertas', {'escritorio_id': escritorio, 'empresa_id': empresa, 'tipo': tipo,
                        'titulo': titulo, 'detalhe': detalhe, 'acao': acao})
    except Exception as e:  # alerta nunca derruba o robô
        log.warning('não consegui criar alerta: %s', e)


def sinal():
    ups('robo_status', {'id': 'principal', 'ultimo_sinal': iso(), 'versao': VERSAO, 'maquina': MAQUINA})


# ---------------------------------------------------------------- agenda

def agendar():
    """Cria a execução do dia para cada rotina ligada cujo horário já passou."""
    t = agora()
    dia = (t.weekday() + 1) % 7  # 0 = domingo, como no site
    inicio_dia = t.replace(hour=0, minute=0, second=0, microsecond=0)
    for r in sel('rotinas', ativa='eq.true', select='*'):
        if dia not in (r['dias_semana'] or []):
            continue
        h, m = map(int, str(r['horario'])[:5].split(':'))
        if (t.hour, t.minute) < (h, m):
            continue
        ja = sel('execucoes', escritorio_id=f"eq.{r['escritorio_id']}", origem='eq.agendada',
                 solicitada_em=f'gte.{inicio_dia.isoformat()}', select='id', limit='1')
        if not ja:
            ins('execucoes', {'escritorio_id': r['escritorio_id'], 'origem': 'agendada', 'status': 'pendente'})
            log.info('execução agendada criada para o escritório %s', r['escritorio_id'])


def periodo(tipo_periodo):
    hoje = agora().date()
    if tipo_periodo == 'mes_atual':
        ini, fim = hoje.replace(day=1), hoje
    else:
        fim = hoje.replace(day=1) - dt.timedelta(days=1)
        ini = fim.replace(day=1)
    return ini.strftime('%d/%m/%Y'), fim.strftime('%d/%m/%Y'), ini.isoformat()


# ---------------------------------------------------------------- navegador

def diagnostico(page, nome):
    """Salva print e HTML da tela quando algo dá errado, para ajustar o robô depois."""
    try:
        DIAG.mkdir(exist_ok=True)
        base = DIAG / f"{agora():%Y%m%d-%H%M%S}-{re.sub(r'[^a-z0-9]+', '-', nome.lower())[:40]}"
        page.screenshot(path=str(base) + '.png', full_page=True)
        Path(str(base) + '.html').write_text(page.content(), encoding='utf-8')
        return base.name
    except Exception:
        return None


def tem_senha_na_tela(page):
    try:
        return page.locator('input[type=password]:visible').count() > 0
    except PWError:
        return False


def preencher_login(page, cred):
    cpf = page.locator('input[placeholder*="CPF" i]:visible, input[name*="cpf" i]:visible, input[id*="cpf" i]:visible').first
    if cpf.count() == 0:
        cpf = page.locator('input[type=text]:visible').first
    cpf.click()
    cpf.fill('')
    cpf.type(re.sub(r'\D', '', cred['cpf']), delay=40)
    page.locator('input[type=password]:visible').first.fill(cred['senha'])
    page.get_by_role('button', name=re.compile('Autenticar', re.I)).first.click()
    page.wait_for_load_state('networkidle', timeout=60000)
    if tem_senha_na_tela(page):
        texto = page.inner_text('body')[:2000]
        motivo = re.search(r'(senha[^\n.]*|credenci[^\n.]*|inv[aá]lid[^\n.]*|bloquead[^\n.]*)', texto, re.I)
        raise LoginRecusado(motivo.group(0) if motivo else 'A Sefaz não aceitou o CPF e a senha.')


def entrar(page, cred, escritorio):
    page.goto(PORTAL, wait_until='networkidle', timeout=60000)
    if tem_senha_na_tela(page):
        log.info('fazendo login na Sefaz')
        preencher_login(page, cred)
    upd('credenciais_sefaz', {'escritorio_id': f'eq.{escritorio}'}, {'situacao': 'ok', 'ultimo_teste': iso()})


def abrir_consulta(page, cred):
    page.goto(CONSULTA, wait_until='networkidle', timeout=60000)
    if tem_senha_na_tela(page):  # "Este módulo requer nova autenticação"
        preencher_login(page, cred)
        page.goto(CONSULTA, wait_until='networkidle', timeout=60000)
    page.wait_for_selector('#cmpNumIeDest', timeout=30000)


def esperar_verificacao(page, form, ctx_exec):
    """Espera o Cloudflare liberar (token preenchido). Não clica: se pedir clique, avisa e espera alguém."""
    limite = time.time() + ESPERA_VERIFICACAO_MIN * 60
    avisou = False
    inicio = time.time()
    while time.time() < limite:
        v = page.evaluate("""s => { const f = document.querySelector(s); if (!f) return 'sem-form';
            const i = f.querySelector('[name="cf-turnstile-response"]'); return i ? i.value : 'sem-widget'; }""", form)
        if v:
            return
        if not avisou and time.time() - inicio > 30:
            log.warning('a Sefaz pediu a verificação "Confirme que é humano" — aguardando um clique na janela do Chrome')
            if not ctx_exec.get('avisou_verificacao'):
                alerta(ctx_exec['escritorio'], 'erro', 'Sefaz pediu a verificação "Confirme que é humano"',
                       f'Clique na caixinha na janela do Chrome do robô ({MAQUINA}). Ele espera {ESPERA_VERIFICACAO_MIN} min.')
                ctx_exec['avisou_verificacao'] = True
            avisou = True
        time.sleep(2)
    raise SemVerificacao('A Sefaz pediu a verificação "Confirme que é humano" e ninguém clicou a tempo.')


def setar(page, seletor, valor):
    page.evaluate("""([s, v]) => { const e = document.querySelector(s); e.value = v;
        e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); }""",
                  [seletor, valor])


def consultar(page, cred, emp, tipo, ini, fim, ctx_exec):
    abrir_consulta(page, cred)
    setar(page, '#cmpDataInicial', ini)
    setar(page, '#cmpDataFinal', fim)
    setar(page, '#cmpNumIeDest', re.sub(r'\D', '', emp['ie']))
    page.locator(f'input[name=cmpTipoNota][value="{0 if tipo == "entrada" else 1}"]').check(force=True)
    page.select_option('#cmpModelo', {'todos': '-', '55': '55', '65': '65'}.get(emp['modelo'], '-'))
    page.select_option('#cmpExbNotasCanceladas', '2' if emp['exibir_canceladas'] else '1')
    esperar_verificacao(page, '#filtro', ctx_exec)
    page.click('#btnPesquisar')
    page.wait_for_load_state('networkidle', timeout=90000)
    texto = page.inner_text('body')
    m = re.search(r'Total de notas:\s*(\d+)', texto)
    if m:
        return int(m.group(1))
    if re.search(r'nenhum[a]? (nota|registro|resultado)|n[ãa]o (foram )?encontrad', texto, re.I):
        return 0
    if tem_senha_na_tela(page):
        raise RuntimeError('A Sefaz pediu login de novo no meio da consulta.')
    raise RuntimeError('Resposta inesperada da Sefaz na consulta: ' + ' '.join(texto.split())[:160])


def pedir_download(page, emp):
    page.get_by_role('button', name=re.compile('Baixar todos os arquivos', re.I)).first.click()
    opcao = 'Baixar documentos e eventos' if emp['incluir_eventos'] else 'Baixar somente documentos'
    page.get_by_text(opcao, exact=False).first.click()
    page.get_by_role('button', name=re.compile(r'^\s*Baixar\s*$', re.I)).last.click()
    page.wait_for_load_state('networkidle', timeout=60000)
    page.wait_for_timeout(1500)


def abrir_historico(page, cred, ctx_exec):
    abrir_consulta(page, cred)
    esperar_verificacao(page, '#historicoDownload', ctx_exec)
    page.click('#btnHistoricoDownload')
    page.wait_for_load_state('networkidle', timeout=60000)


def linhas_historico(page):
    return page.evaluate("""() => [...document.querySelectorAll('table tbody tr')].map((tr, i) => ({
        i, texto: tr.innerText.replace(/\\s+/g, ' ').trim(),
        temLink: !!tr.querySelector('a[href], button:not([disabled])')
    }))""")


def baixar_do_historico(page, cred, pedidos, ctx_exec):
    """pedidos: lista de dicts {ie, tipo, ini, fim, ...}. Baixa o ZIP de cada um quando ficar pronto."""
    pendentes = list(pedidos)
    limite = time.time() + ESPERA_FILA_MIN * 60
    primeira = True
    usadas = set()
    while pendentes and time.time() < limite:
        if not primeira:
            time.sleep(60)
        primeira = False
        abrir_historico(page, cred, ctx_exec)
        linhas = linhas_historico(page)
        if not linhas:
            diagnostico(page, 'historico-vazio')
            continue
        for p in list(pendentes):
            ie = re.sub(r'\D', '', p['emp']['ie'])
            cand = [l for l in linhas if l['i'] not in usadas and ie in re.sub(r'\D', '', l['texto'])]
            tipo_pal = 'entrada' if p['tipo'] == 'entrada' else 'sa[ií]da'
            cand_tipo = [l for l in cand if re.search(tipo_pal, l['texto'], re.I)]
            if cand_tipo:
                cand = cand_tipo
            if not cand:
                continue
            linha = cand[0]  # o histórico costuma listar o mais recente primeiro
            if re.search(r'processando|em process|aguard|fila|pendente', linha['texto'], re.I) or not linha['temLink']:
                continue
            if re.search(r'erro|falh|expirad', linha['texto'], re.I):
                p['erro'] = 'A Sefaz não conseguiu gerar o arquivo: ' + linha['texto'][:120]
                usadas.add(linha['i']); pendentes.remove(p)
                continue
            tr = page.locator('table tbody tr').nth(linha['i'])
            botao = tr.locator('a[href*="download" i], a:has-text("Baixar"), a:has-text("Download"), button:has-text("Baixar"), button:has-text("Download"), a[href]').first
            try:
                with page.expect_download(timeout=120000) as dl:
                    botao.click()
                p['zip'] = dl.value
                usadas.add(linha['i']); pendentes.remove(p)
            except PWError as e:
                p['erro'] = 'Não consegui baixar o arquivo do histórico: ' + str(e)[:120]
                diagnostico(page, 'historico-download')
                usadas.add(linha['i']); pendentes.remove(p)
    for p in pendentes:
        p['erro'] = f'O arquivo não ficou pronto na fila da Sefaz em {ESPERA_FILA_MIN} min.'
        diagnostico(page, 'historico-sem-arquivo')


# ---------------------------------------------------------------- arquivos

def limpo(txt):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]+', ' ', txt).strip().rstrip('.')[:120]


def salvar_zip(download, pasta_base, emp, comp, tipo):
    destino = Path(pasta_base) / limpo(f"{emp['codigo']} - {emp['razao_social']}" if emp.get('codigo') else emp['razao_social']) \
        / comp[:7] / ('Entrada' if tipo == 'entrada' else 'Saida')
    destino.mkdir(parents=True, exist_ok=True)
    zip_path = destino / f"{tipo}-{comp[:7]}-{agora():%Y%m%d-%H%M%S}.zip"
    download.save_as(str(zip_path))
    notas = 0

    def extrair(z, alvo):
        nonlocal notas
        with zipfile.ZipFile(z) as zf:
            for nome in zf.namelist():
                if nome.endswith('/'):
                    continue
                dados = zf.read(nome)
                if nome.lower().endswith('.zip'):
                    tmp = alvo / Path(nome).name
                    tmp.write_bytes(dados)
                    extrair(tmp, alvo)
                    tmp.unlink(missing_ok=True)
                    continue
                (alvo / Path(nome).name).write_bytes(dados)
                if nome.lower().endswith('.xml') and b'procEvento' not in dados[:4000] and (b'<nfeProc' in dados[:4000] or b'<NFe' in dados[:4000]):
                    notas += 1

    extrair(zip_path, destino)
    return str(destino), notas


# ---------------------------------------------------------------- execução

def erro_download(d, msg):
    upd('downloads', {'id': f"eq.{d['id']}"}, {'status': 'erro', 'mensagem': msg[:400], 'atualizado_em': iso()})


def avisar_mudanca(esc, emp, comp, tipo, qtd, d_id):
    ant = sel('downloads', empresa_id=f"eq.{emp['id']}", competencia=f'eq.{comp}', tipo=f'eq.{tipo}',
              status='eq.concluido', id=f'neq.{d_id}', select='qtd_notas', order='atualizado_em.desc', limit='1')
    if ant and ant[0]['qtd_notas'] is not None and qtd > ant[0]['qtd_notas']:
        novas = qtd - ant[0]['qtd_notas']
        alerta(esc, 'mudanca', f'{novas} nota(s) nova(s) de {tipo} depois do último download',
               f'Competência {comp[5:7]}/{comp[:4]}', empresa=emp['id'])


def executar(ctx, exe, somente_ie=None):
    esc = exe['escritorio_id']
    log.info('== execução %s (escritório %s)', exe['id'], esc)
    upd('execucoes', {'id': f"eq.{exe['id']}"}, {'status': 'rodando', 'iniciada_em': iso()})
    ctx_exec = {'escritorio': esc}
    rot = (sel('rotinas', escritorio_id=f'eq.{esc}', select='*') or [{}])[0]
    pasta = rot.get('pasta_destino') or r'C:\Notas'
    cred = rpc('robo_obter_credencial', {'p_escritorio': esc})
    if not cred:
        alerta(esc, 'erro', 'Login da Sefaz não cadastrado', 'Cadastre o CPF e a senha em Acesso à Sefaz.', acao='atualizar_senha')
        upd('execucoes', {'id': f"eq.{exe['id']}"}, {'status': 'falhou', 'finalizada_em': iso()})
        return
    cred = cred[0]
    filtro = {'escritorio_id': f'eq.{esc}', 'ativa': 'eq.true', 'ie': 'not.is.null', 'select': '*', 'order': 'razao_social'}
    if somente_ie:
        filtro['ie'] = f'eq.{somente_ie}'
    empresas = sel('empresas', **filtro)
    ini, fim, comp = periodo(rot.get('periodo', 'mes_anterior'))
    log.info('período %s a %s · %d empresa(s)', ini, fim, len(empresas))
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    try:
        entrar(page, cred, esc)
    except LoginRecusado as e:
        upd('credenciais_sefaz', {'escritorio_id': f'eq.{esc}'}, {'situacao': 'recusada', 'ultimo_teste': iso()})
        alerta(esc, 'erro', 'Senha da Sefaz recusada', str(e), acao='atualizar_senha')
        upd('execucoes', {'id': f"eq.{exe['id']}"}, {'status': 'falhou', 'finalizada_em': iso()})
        return

    erros = 0
    pedidos = []
    for emp in empresas:
        for tipo in ('entrada', 'saida'):
            if not emp[f'baixar_{tipo}']:
                continue
            d = ins('downloads', {'execucao_id': exe['id'], 'empresa_id': emp['id'], 'escritorio_id': esc,
                                  'competencia': comp, 'tipo': tipo, 'status': 'processando'})[0]
            try:
                n = consultar(page, cred, emp, tipo, ini, fim, ctx_exec)
                log.info('%s · %s: %d nota(s)', emp['razao_social'], tipo, n)
                if n == 0:
                    upd('downloads', {'id': f"eq.{d['id']}"}, {'status': 'sem_notas', 'qtd_notas': 0, 'atualizado_em': iso()})
                    continue
                pedir_download(page, emp)
                upd('downloads', {'id': f"eq.{d['id']}"}, {'status': 'fila', 'qtd_notas': n, 'mensagem': 'Na fila da Sefaz', 'atualizado_em': iso()})
                pedidos.append({'d': d, 'emp': emp, 'tipo': tipo, 'n': n})
            except Exception as e:
                erros += 1
                arq = diagnostico(page, f"{emp['ie']}-{tipo}")
                log.error('%s · %s: %s', emp['razao_social'], tipo, e)
                erro_download(d, f'{e}' + (f' (print salvo no PC: {arq})' if arq else ''))

    if pedidos:
        log.info('buscando %d arquivo(s) no histórico da Sefaz', len(pedidos))
        try:
            baixar_do_historico(page, cred, pedidos, ctx_exec)
        except Exception as e:
            for p in pedidos:
                p.setdefault('erro', f'Falha no histórico de downloads: {e}')
            diagnostico(page, 'historico-falha')
        for p in pedidos:
            if p.get('zip'):
                try:
                    caminho, qtd = salvar_zip(p['zip'], pasta, p['emp'], comp, p['tipo'])
                    upd('downloads', {'id': f"eq.{p['d']['id']}"}, {'status': 'concluido', 'qtd_notas': qtd or p['n'],
                                                                     'arquivo': caminho, 'mensagem': None, 'atualizado_em': iso()})
                    avisar_mudanca(esc, p['emp'], comp, p['tipo'], qtd or p['n'], p['d']['id'])
                    log.info('%s · %s: salvo em %s (%d XML)', p['emp']['razao_social'], p['tipo'], caminho, qtd)
                    continue
                except Exception as e:
                    p['erro'] = f'Não consegui salvar/descompactar: {e}'
            erros += 1
            erro_download(p['d'], p.get('erro', 'Arquivo não baixado.'))

    status = 'concluida' if not erros else ('com_erros' if erros < 2 * max(len(empresas), 1) else 'falhou')
    upd('execucoes', {'id': f"eq.{exe['id']}"}, {'status': status, 'finalizada_em': iso()})
    log.info('== execução %s terminou: %s', exe['id'], status)


# ---------------------------------------------------------------- principal

def abrir_chrome(p):
    PERFIL.mkdir(exist_ok=True)
    return p.chromium.launch_persistent_context(
        str(PERFIL), channel='chrome', headless=False, accept_downloads=True,
        no_viewport=True, args=['--start-maximized'])


def configurar_log():
    log.setLevel(logging.INFO)
    fmt = logging.Formatter('%(asctime)s %(levelname)s %(message)s', '%d/%m %H:%M:%S')
    arq = RotatingFileHandler(BASE / 'robo.log', maxBytes=2_000_000, backupCount=3, encoding='utf-8')
    arq.setFormatter(fmt)
    tela = logging.StreamHandler(sys.stdout)
    tela.setFormatter(fmt)
    log.addHandler(arq)
    log.addHandler(tela)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--teste', metavar='IE', help='roda agora só para a empresa com essa inscrição estadual e sai')
    args = ap.parse_args()
    configurar_log()
    if not SUPABASE_URL or not SUPABASE_KEY or 'COLE' in SUPABASE_KEY:
        log.error('Preencha SUPABASE_URL e SUPABASE_SECRET_KEY no arquivo .env')
        input('Enter para sair...')
        return
    log.info('Robô %s iniciado na máquina %s', VERSAO, MAQUINA)
    # execuções que ficaram "rodando" por queda do PC
    upd('execucoes', {'status': 'eq.rodando', 'iniciada_em': f'lt.{iso(agora() - dt.timedelta(hours=3))}'},
        {'status': 'falhou', 'finalizada_em': iso()})

    with sync_playwright() as p:
        ctx = abrir_chrome(p)
        if args.teste:
            ie = re.sub(r'\D', '', args.teste)
            emp = sel('empresas', ie=f'eq.{ie}', select='id,escritorio_id,razao_social', limit='1')
            if not emp:
                log.error('Nenhuma empresa com IE %s no painel.', ie)
                return
            sinal()
            exe = ins('execucoes', {'escritorio_id': emp[0]['escritorio_id'], 'origem': 'manual', 'status': 'pendente'})[0]
            executar(ctx, exe, somente_ie=ie)
            input('Teste terminado. Veja o resultado no painel. Enter para fechar...')
            return
        while True:
            try:
                sinal()
                agendar()
                pend = sel('execucoes', status='eq.pendente', order='solicitada_em', limit='1', select='*')
                if pend:
                    try:
                        executar(ctx, pend[0])
                    except PWError as e:
                        log.error('o Chrome fechou ou travou: %s — reabrindo', e)
                        upd('execucoes', {'id': f"eq.{pend[0]['id']}"}, {'status': 'falhou', 'finalizada_em': iso()})
                        try:
                            ctx.close()
                        except Exception:
                            pass
                        ctx = abrir_chrome(p)
                    except Exception:
                        log.error('a execução falhou:\n%s', traceback.format_exc())
                        upd('execucoes', {'id': f"eq.{pend[0]['id']}"}, {'status': 'falhou', 'finalizada_em': iso()})
                    continue
            except requests.RequestException as e:
                log.warning('sem conexão com o painel: %s', e)
            except Exception:
                log.error('erro inesperado:\n%s', traceback.format_exc())
            time.sleep(60)


if __name__ == '__main__':
    main()
