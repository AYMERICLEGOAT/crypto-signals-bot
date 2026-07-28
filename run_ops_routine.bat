@echo off
cd /d "C:\code vs code\projet crypto"
echo ==== %date% %time% ==== >> ops_routine.log
"C:\Users\aymer\AppData\Roaming\npm\claude.cmd" -p "Lis OPS_ROUTINE_PROMPT.md a la racine du depot et execute integralement la routine qui y est decrite, dans l'ordre." --dangerously-skip-permissions >> ops_routine.log 2>&1
echo ==== fin %date% %time% ==== >> ops_routine.log
