@echo off
:loop
cd /d "C:\Users\DIOP\Desktop\PLATEFORME"
C:\Python313\python.exe app.py
echo Serveur arrete - redemarrage dans 5 secondes...
timeout /t 5 /nobreak
goto loop
