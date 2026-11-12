# Ficha Virtual — plataforma de TTRPG (v3.1)

Servidor Node.js (sem framework) + PostgreSQL (Neon) + front-end estático em `public/`.
Contas individuais, campanhas, fichas privadas, **conteúdo global do jogo controlado pela conta DEV**, tempo real e proteções contra sobrescrita.

## Arquitetura
| Parte | Arquivo | Função |
|---|---|---|
| Servidor HTTP/API | `server.js` | rotas, autenticação, sessões, permissões, tempo real (SSE) |
| Banco | `db.js` | PostgreSQL via `DATABASE_URL` (produção) ou SQLite embutido do Node (somente dev/testes) |
| Migrations | `migrations/*.sql`, `migrate.js` | esquema versionado e protegido |
| Conteúdo global | `content.js` | **único** escritor de poções/caminhos/configurações; versões, transações, integridade, backups, seed |
| Painel DEV | `private/dev-panel.js` | entregue só à conta DEV por `/api/dev/panel.js` |
| Cliente | `public/index.html` | ficha, campanhas, perfil, poções (somente leitura), inventário |
| Proteção | `scripts/safety-check.js`, `AGENTS.md` | verificação estática no build + regras para IA |

## Tabelas
- **Individuais (jogadores):** `users` (e-mail, usuário, hash, `role`, foto), `sessions`, `password_resets`, `rate_limits`, `campaigns`, `members`, `sheets` (ficha em JSON, privada), `inventory` (poção × quantidade por ficha).
- **Globais (conteúdo do jogo):** `paths`, `potions`, `aptitudes` (cada uma com `status` = active | hidden | deleted), `content_blobs` (imagens, por hash), `game_settings`.
- **Itens do inventário (v3.1):** `sheet_items` (nome, foto e descrição opcionais, quantidade) — privados ao dono da ficha e ao mestre. A tabela antiga `inventory` (poções) foi mantida intacta e sem uso: nada é apagado.
- **Proteção/histórico:** `content_versions` (toda alteração, autor, data, snapshot), `content_backups`, `admin_log`, `app_meta` (checksum de integridade), `schema_migrations`.
- Jogadores referenciam o conteúdo global só por id (`inventory.potion_id`) ou slug (`sheet.path`). Nada global é copiado para fichas/campanhas.

## Autenticação
Cadastro com e-mail + usuário + senha (+ foto opcional). E-mail e usuário únicos (sem diferenciar maiúsculas). Senha com **scrypt** (parâmetros no hash; hashes antigos são atualizados no login).
Sessão em cookie `HttpOnly; SameSite=Lax; Secure` (token aleatório, só o SHA-256 vai ao banco), expiração deslizante de 30 dias (máximo 90), logout e troca de senha invalidam sessões. Limite de tentativas por IP e por conta (no banco). Recuperação de senha por link de uso único (1 h) — precisa de provedor de e-mail (abaixo).

## Criar/promover a conta DEV
A permissão vive em `users.role` (no banco), conferida no servidor em **toda** rota `/api/dev/*`. O nome de usuário não dá poder algum (nomes como "dev"/"admin" são reservados).
1. Crie sua conta normalmente pelo site.
2. No Render, defina `DEV_EMAIL=seu@email.com` e reinicie. A conta é promovida **apenas se ainda não existir nenhum DEV**. Depois pode remover a variável.
3. Alternativa: no *Shell* do serviço no Render: `node scripts/promote-dev.js seu@email.com` (também serve para rebaixar: `... player`).
> Crie sua conta ANTES de definir `DEV_EMAIL` (o e-mail não é verificado; quem registrar esse e-mail primeiro seria promovido).

## Neon + Render
1. **Neon:** crie o projeto e copie a *connection string* (use a "Pooled connection", termina com `?sslmode=require`).
2. **Render:** crie um **Web Service** (não Static Site) com o repositório, ou use o Blueprint (`render.yaml`).
   Build: `npm install && npm run safety` · Start: `npm start`.
3. Variáveis de ambiente no Render:
   | Variável | Obrigatória | Uso |
   |---|---|---|
   | `DATABASE_URL` | sim | connection string do Neon |
   | `NODE_ENV=production` | sim | cookies `Secure`, HSTS, recusa SQLite local |
   | `NODE_VERSION=22` | sim | Node ≥ 22.5 |
   | `DEV_EMAIL` | para criar o 1º DEV | ver acima |
   | `APP_URL` | recomendado | ex.: `https://seu-site.onrender.com` (link de recuperação) |
   | `RESEND_API_KEY`, `MAIL_FROM` | para recuperar senha | envio de e-mail via Resend. Sem isso a recuperação fica desativada |
   | `SEED_CONTENT=false` | opcional | desliga o conteúdo inicial (3 caminhos, Árbitro 9–7) |
   | `PGSSL_INSECURE=true` | só se necessário | desativa a verificação do certificado (não recomendado) |
4. As migrations rodam sozinhas no start. Os dados ficam no Neon: reinícios e deploys não os apagam.

## Novidades da v3.1
- **Aptidões globais:** o DEV cria/edita/oculta/exclui aptidões no painel (talentos com bônus + perícias concedidas). O seletor de perícias funciona como na ficha: clique no d20 para definir o nível mínimo (Aprendiz, Apto, Mestre, Grão-Mestre). As 3 aptidões originais são semeadas uma única vez (e só se a tabela estiver vazia), mantendo os ids de talento 0/1/2 para não perder os interruptores das fichas antigas.
- **Diretivas de perícia nas poções:** além de `mestre:Perícia`, agora existem `aprendiz:`, `apto:` e `graomestre:` (o nível é garantido como mínimo; nunca reduz). Dá para digitar ou usar o mesmo seletor de d20 no editor da poção.
- **Inventário de itens:** nova página dentro da ficha (itens com foto e descrição opcionais — só aparecem se forem escolhidas). O inventário de poções foi removido da ficha.
- **Menu lateral da ficha:** Campanha · Ficha · Inventário (só aparece dentro da ficha).
- **Checksum versionado:** a fórmula de integridade evoluiu (v2 inclui aptidões). Ao subir o código novo, o servidor primeiro confere o conteúdo com a fórmula antiga e só então migra — adulteração continua detectável e nada vira falso alarme. **Voltar para uma versão mais antiga do código** faz o servidor entrar em modo de proteção (use "Aceitar estado atual" no painel DEV).

## Conteúdo global
Toda alteração do DEV (criar, editar, ocultar, reexibir, excluir, restaurar) é gravada **no Neon**, numa transação, com `base_rev` (edições simultâneas conflitantes recebem 409), nova versão no histórico (autor/data/snapshot) e atualização do checksum. Todos os jogadores, em **todas** as campanhas, passam a ver a versão nova (aviso em tempo real).
- **Ocultar** → some para jogadores; continua no banco. **Reexibir** → volta.
- **Excluir** → exclusão lógica (`status=deleted`): inventários antigos continuam íntegros e listam o item como "indisponível". Pode ser restaurada.
- Jogadores só recebem camadas que já alcançaram; textos ocultos desativados nunca saem do servidor.

## Proteção contra sobrescrita
1. **Migrations** (`migrate.js`): bloqueiam `DROP/DELETE/UPDATE/INSERT/TRUNCATE/ALTER…DROP` em tabelas protegidas e migrations já aplicadas que foram editadas. A mensagem informa alteração, conteúdo afetado, motivo, consequências e alternativa segura. Exceção exige marcador no arquivo **e** variável `ALLOW_DESTRUCTIVE_MIGRATIONS`. Backup do conteúdo é gravado no banco antes de migrar.
2. **Build** (`npm run safety`): falha se qualquer arquivo (fora de `content.js`) escrever em conteúdo global ou reaplicar o seed. Se o build falha, o Render mantém a versão anterior no ar.
3. **Integridade em runtime**: checksum do conteúdo. Se alguém alterar o banco por fora (SQL, script, restauração antiga), o servidor avisa e **bloqueia edições (423)** até um DEV revisar e usar "Aceitar estado atual" (gera backup + registro).
4. **Seed**: só em banco vazio e uma única vez; nunca sobrescreve.
5. `AGENTS.md` / `CLAUDE.md`: regras para assistentes de IA (parar e avisar antes de qualquer conflito).

## Backups
Dentro do banco: `content_backups` (últimos 20; automático antes de migrar e ao aceitar integridade; manual pelo painel DEV, com download em JSON). Backup completo local: `npm run backup`. No Neon, use também o *restore* por ponto no tempo/branches do próprio Neon.

## Testes
`npm test` (API, permissões, conteúdo global, itens, aptidões, persistência com reinício, proteções, banco antigo e **atualização de um banco com edições do DEV** — fixture em `test/fixtures`) e `npm run test:ui` (Chrome; requer `puppeteer-core`, `PUPPETEER_PATH` e `CHROME_PATH`).
Rodar localmente: `node server.js` (usa SQLite em `data.sqlite`, Node ≥ 22.5).
