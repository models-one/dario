@echo off
"%TEMPLATE_NODE_BIN%" "%~dp0claude-loopback.mjs" %*
exit /b %errorlevel%
