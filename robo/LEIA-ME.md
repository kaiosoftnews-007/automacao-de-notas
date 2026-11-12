# Robô da Automação de Notas

Roda no computador do escritório que fica ligado. Usa o Google Chrome desse computador.

## Instalar (uma vez)

1. Instale o **Python 3.12** em python.org. Na primeira tela do instalador, marque **"Add python.exe to PATH"**.
2. Copie esta pasta `robo` para o computador (ex.: `C:\AutomacaoNotas\robo`).
3. Dê dois cliques em **INSTALAR.bat**.
4. Vai abrir o Bloco de Notas com o arquivo `.env`. Cole a **chave secreta** do Supabase
   (Project Settings → API Keys → Secret keys, começa com `sb_secret_`) no lugar de `COLE_AQUI_A_CHAVE_SECRETA` e salve.

O instalador também deixa o robô abrindo sozinho quando o Windows inicia.

## Testar com uma empresa

Dê dois cliques em **TESTAR.bat** e digite a inscrição estadual (ex.: `202843025`).
O Chrome abre, entra na Sefaz, consulta outubro/entrada e saída, pede o download e salva na pasta da rotina.
O resultado aparece no painel, na Rotina e em Downloads do escritório.

## Usar no dia a dia

Dê dois cliques em **INICIAR.bat** (ou reinicie o computador). Deixe a janela preta e o Chrome abertos.
O painel mostra "Robô online" no menu.

## Se a Sefaz pedir "Confirme que é humano"

O robô **não** clica nessa verificação. Ele espera até 10 minutos e avisa nos Alertas do painel.
Basta alguém clicar na caixinha na janela do Chrome do robô que ele continua sozinho.

## Quando algo dá errado

- Os erros aparecem no painel (Alertas e Downloads).
- O robô salva um print da tela da Sefaz na pasta `diagnostico` e o histórico em `robo.log`.
  Mande esses arquivos para ajustarmos o robô.
