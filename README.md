# Ficha Virtual

Site estático (HTML + CSS + JS, sem build). Os dados da ficha ficam salvos no navegador de cada jogador (localStorage).

## Publicar no Render
1. Suba esta pasta para um repositório no GitHub.
2. No Render: New + > Static Site > escolha o repositório.
3. Build Command: (vazio) · Publish Directory: `.`
4. Create Static Site. A cada `git push` o site atualiza sozinho.

Para testar localmente: `python3 -m http.server 8000` e abra http://localhost:8000
