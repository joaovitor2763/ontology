# Rodar o Ontology localmente

Atualizado em **02/10/2026**. Base: `package.json`, `next.config.ts`, `wrangler.jsonc`, autenticação e persistência do código. Esta edição pública é independente do ambiente original.

[Índice](index.md) · [Onde e como editar](guia-de-contribuicao.md) · [Deploy](../DEPLOY.md)

## 1. Pré-requisitos e clone

- Git, acesso ao repositório público e **Node.js 24** (mesma versão dos workflows).
- npm fornecido com Node. Confira `node --version` e `npm --version`.
- GitHub CLI é útil para clone e PR, mas não é dependência da aplicação.
- Não precisa de conta Cloudflare para trabalhar com os bindings **locais**, nem de chaves Google/IA para começar.

```bash
# Se usar GitHub CLI, autentique sua própria conta: gh auth login
# Nunca copie tokens de outro colaborador.
gh repo clone joaovitor2763/ontology
cd ontology
npm ci
```

Se já tem um clone, entre nele e confira `git remote -v`, `git status` e a branch antes de alterar. Não use `npm install` para atualizar dependências sem intenção: `npm ci` reproduz o lockfile.

## 2. Escolha o modo

| Modo | Uso | Dados | Limites |
| --- | --- | --- | --- |
| Demonstração no navegador | Conferir telas e dados fictícios | Navegador, sem sincronizar o workspace | Não valida APIs, autorização ou jobs do servidor |
| D1/R2 locais | Desenvolver fluxos reais e testar persistência e permissões | Emuladores sob `.wrangler/` | Não é o banco de staging/produção; integrações externas continuam desligadas |
| Preview OpenNext | Conferir o bundle do Worker antes de publicar | Bindings locais | Mais lento; não prova que a infraestrutura publicada está saudável |

**Importante:** `next.config.ts` inicializa bindings Cloudflare a partir de `wrangler.jsonc`. A ausência de `.dev.vars` **não é uma garantia** de modo demonstração. Configure explicitamente o modo e a identidade.

### A. Demonstração no navegador

```bash
NEXT_PUBLIC_PERSISTENCE=local npm run dev
```

Abra <http://localhost:3000>. No modo local, `/entrar` não faz login; a identidade demonstrativa é escolhida em **Configurações → Ver como**. Não envie arquivos nem teste integrações do servidor neste modo sem configurar o ambiente seguro abaixo: forçar a persistência local afeta o cliente, não desliga todas as rotas do servidor.

Alternativa persistente: definir `NEXT_PUBLIC_PERSISTENCE=local` em `.env.local` (ignorado pelo Git). Remova essa definição e reinicie o Next quando voltar ao modo com D1. Variáveis `NEXT_PUBLIC_*` são incorporadas no frontend; não coloque segredos nelas. Não use esse override em builds destinados a publicação.

### B. Desenvolvimento completo com D1/R2 locais (recomendado)

1. Se `.dev.vars` **não existe**, copie o exemplo:

```bash
cp .dev.vars.example .dev.vars
```

Não sobrescreva um arquivo existente: ele pode conter credenciais. Edite-o localmente e mantenha estes valores para começar sem serviços externos:

```dotenv
NEXTJS_ENV=development
AUTH_MODE=dev
DEV_USER_EMAIL=dev@example.com
DEV_USER_NAME=Desenvolvedor
WORKSPACE_ID=default
AI_ENABLED=false
WHATSAPP_ENABLED=false
GOOGLE_ENABLED=false
CF_ACCESS_TEAM_DOMAIN=
CF_ACCESS_AUD=
```

Use um endereço fictício de desenvolvimento. Mantenha integrações externas desligadas e não copie credenciais de ambientes compartilhados.

2. Garanta que `NEXT_PUBLIC_PERSISTENCE=local` não esteja definido no shell ou em `.env.local`.
3. Aplique as migrações **locais**, aceitando a confirmação no terminal:

```bash
npm run db:migrate:local
npm run dev
```

4. Abra <http://localhost:3000>, confira a sincronização e acesse `/entrar` para trocar de membro dev quando precisar. Em um workspace local novo, `SessionBoot` cadastra a primeira identidade real como admin. Se a base já tem alguém com email, uma nova identidade pode ficar aguardando aprovação: entre como admin **desse ambiente local** e aprove em Equipe. Seeds de demonstração não possuem email e não equivalem a usuários reais autenticados.
5. A resposta abaixo ajuda a confirmar o ambiente:

```bash
curl -s http://localhost:3000/api/health
```

Com D1 local, espere `mode: "remote"` e `authMode: "dev"`. **Remote neste JSON significa persistência pelo servidor, não acesso ao banco de produção.** O host, o binding e o comando utilizado distinguem os ambientes. Não use `--remote`, `remote: true` nem scripts de corte/backfill para desenvolver telas.

As escolhas feitas em `/entrar` ficam no cookie dev e prevalecem sobre `DEV_USER_EMAIL`. Para voltar à identidade padrão, saia pela própria tela antes de retestar.

### C. Preview do Worker

Com `.dev.vars` seguro e migrações locais aplicadas:

```bash
npm run preview
```

O script faz build OpenNext e abre o Worker local. Use a URL/porta exibida no terminal; não presuma a mesma porta do Next. Ao testar integrações, credenciais e callbacks exigem configuração separada. `npm run start` serve o build Next, mas **não substitui** esse preview do runtime Cloudflare.

## 3. Ciclo de verificação

```bash
npm run check  # ESLint + TypeScript + testes Node
npm run build  # build Next; não publica nada
```

Para uma tela alterada, confira desktop (1440 px) e mobile (390 px), estados vazios, erro, carregamento e cada nível de permissão relevante. `npm run build` não prova paridade do Worker; para mudanças de runtime, execute também `npm run preview`.

Os testes não usam Jest/Vitest: `npm test` executa `tests/*.test.mjs` com Node 24 e strip-types. Para um teste específico, use o mesmo runner:

```bash
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/permissions.test.mjs
```

## 4. Problemas frequentes

| Sintoma | Verificação / solução |
| --- | --- |
| Erro de strip-types ou flags do Node | Confirme Node 24; execute `npm ci` se mudou a instalação |
| Banco sem tabelas / erro SQL | Execute `npm run db:migrate:local`; não use `db:migrate` (é remoto e aponta produção) |
| Aparece login Google local | `AUTH_MODE=google` está vindo da configuração; defina `AUTH_MODE=dev` em `.dev.vars` e reinicie |
| Está sempre em demonstração | Confira `NEXT_PUBLIC_PERSISTENCE` no shell e `.env.local`; retire o override e reinicie |
| Aguarda aprovação / 403 | Verifique identidade, cookie de `/entrar`, membro ativo, nível de acesso e alocação por cliente |
| Mudou email no arquivo, mas a sessão não mudou | O cookie de login dev pode prevalecer; saia em `/entrar` |
| Conflito 409 | Recarregue dados e refaça a intenção sobre a versão atual; não force gravação do JSON antigo |
| Porta 3000 ocupada | Use `npm run dev -- --port 3100`; confira a URL no terminal e callbacks OAuth se os habilitar |
| Integração indisponível | É esperado com flags false. Habilite somente a integração necessária com credenciais de teste e consentimento |
| Seed mudou, mas dados existentes não | Seeds não substituem estado persistido. Teste uma base/navegador isolado; não apague dados de colegas |

Não apague `.wrangler/`, dados do navegador ou banco para “resolver” sem entender o que será perdido. Nunca compartilhe `.dev.vars`, cookies, tokens, dumps ou arquivos reais de clientes em PR.

## Fontes no código

- [Scripts](../package.json), [bindings](../next.config.ts), [ambientes](../wrangler.jsonc), [exemplo local](../.dev.vars.example).
- [Persistência cliente](../src/shared/infrastructure/persistence.ts), [health](../src/app/api/health/route.ts), [auth](../src/server/auth.ts).
- [Login dev](../src/app/api/dev-login/route.ts), [bootstrap de membro](../src/modules/workspace/presentation/SessionBoot.tsx), [autorização](../src/server/authz.ts).
