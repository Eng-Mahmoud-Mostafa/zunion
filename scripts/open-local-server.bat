@echo off
cd /d C:\Users\DELL\Documents\zunion
title Zunion Local Server
echo Starting Zunion local server on http://127.0.0.1:5195/
echo Keep this window open while using the app.
node scripts\serve-local.cjs
pause
