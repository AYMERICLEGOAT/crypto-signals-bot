@echo off
REM Routine quotidienne autonome (tache planifiee CryptoSignalsBot-GestionnaireGlobal, 14:00).
REM
REM ALERTE AJOUTEE LE 10/08/2026. La routine s'est arretee le 03/08 (limite de
REM depense), puis n'a plus jamais pu s'authentifier -- SEPT jours d'affilee.
REM La tache se declenchait pourtant chaque jour : elle echouait en une seconde
REM et ecrivait deux lignes dans un journal que personne ne lit. Sept jours de
REM gestion perdus sans que quiconque le sache.
REM
REM La sortie est desormais capturee, puis relue par alerte_routine.ps1 qui
REM previent l'administrateur sur Telegram. Se fier au seul code de retour ne
REM suffirait pas : `claude -p` rend parfois 0 en ecrivant son erreur sur la
REM sortie standard, ce qui est precisement le cas qui a dure une semaine.

cd /d "C:\code vs code\projet crypto"

set "SORTIE=%TEMP%\ops_routine_sortie.txt"

echo ==== %date% %time% ==== >> ops_routine.log

"C:\Users\aymer\AppData\Roaming\npm\claude.cmd" -p "Lis OPS_ROUTINE_PROMPT.md a la racine du depot et execute integralement la routine qui y est decrite, dans l'ordre." --dangerously-skip-permissions > "%SORTIE%" 2>&1
set CODE=%ERRORLEVEL%

type "%SORTIE%" >> ops_routine.log
echo ==== fin %date% %time% (code %CODE%) ==== >> ops_routine.log

powershell -NoProfile -ExecutionPolicy Bypass -File "alerte_routine.ps1" -Code %CODE% -Sortie "%SORTIE%" >> ops_routine.log 2>&1

del "%SORTIE%" >nul 2>&1
