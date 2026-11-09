# Regras para assistentes de IA (leia ANTES de alterar qualquer arquivo)

Este projeto tem **conteúdo oficial do jogo** (poções, caminhos, imagens, textos, configurações) que vive no banco (Neon) e é
editado **somente** pela conta DEV, pelo painel da própria aplicação. Dados de jogadores (contas, fichas, inventários, campanhas)
também são permanentes. Código e deploys NUNCA podem sobrescrevê-los.

## Você PODE
- Programar, corrigir bugs e melhorar o sistema de poções/caminhos, a interface de edição e o painel DEV.
- Criar migrations que **apenas adicionam** estruturas (`CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`).
- Alterar `content.js` (único módulo que escreve no conteúdo global) para corrigir/estender funcionalidades, mantendo transação, `base_rev`, versionamento e checksum.

## Você NÃO PODE (pare e avise o usuário ANTES de continuar)
- Escrever (`INSERT/UPDATE/DELETE/TRUNCATE/DROP/ALTER…DROP`) em `paths`, `potions`, `content_*`, `game_settings`, `app_meta`, `users`, `sheets`, `inventory`… fora de `content.js`.
- Colocar poções/caminhos/textos/imagens "oficiais" no código-fonte, no seed, em migrations ou em scripts para serem aplicados em produção.
- Reaplicar ou alterar `seed/` esperando que isso mude produção (o seed só roda em banco **vazio**, uma única vez).
- Editar migrations já aplicadas; criar migration destrutiva; aprovar `ALLOW_DESTRUCTIVE_MIGRATIONS` por conta própria.
- Contornar `npm run safety`, o checksum de integridade (423 "PROTEÇÃO ATIVA") ou o executor de migrations.

## Como avisar (obrigatório quando houver conflito)
Interrompa a operação e informe explicitamente:
1. qual alteração estava planejada;
2. qual conteúdo poderia ser afetado;
3. por que há conflito;
4. quais as possíveis consequências;
5. qual é a alternativa segura.
Nunca execute automaticamente operações destrutivas ou conflitantes. Em dúvida, pergunte.

## Verificações automáticas (existem para barrar erros, inclusive os da IA)
- `npm run safety` (roda no build do Render): falha se achar escrita indevida em conteúdo global ou migration destrutiva.
- Executor de migrations (`migrate.js`): bloqueia migrations destrutivas/adulteradas e faz backup do conteúdo antes de migrar.
- Checksum de integridade: se o conteúdo mudar fora da aplicação, as edições ficam bloqueadas até um DEV revisar e aceitar.
- `npm test` deve passar antes de qualquer entrega.
