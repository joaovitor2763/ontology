# Publicar sua plataforma na Cloudflare

Você terá um Worker, banco D1 e bucket R2 na **sua própria conta**. Não há conexão com o ambiente do mantenedor. Licença [MIT](LICENSE).

## 1. Deploy pelo botão

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/joaovitor2763/ontology/tree/main)

1. Entre no GitHub e na Cloudflare pelo fluxo oficial; escolha nome do repositório e Worker.
2. Use **Node.js 24**, comando de build `npm ci` e comando de deploy `npm run deploy`.
3. Habilite R2 na conta se o painel solicitar. Recursos e provedores podem ter custos próprios. SSR e jobs podem ultrapassar a franquia de CPU do plano gratuito; confira os [limites atuais](https://developers.cloudflare.com/workers/platform/limits/) e considere Workers Paid para produção.

O comando de deploy compila com OpenNext, procura/cria o D1 `<nome-do-worker>-db`, aplica as migrações e só então publica o código. O Wrangler provisiona R2. Os IDs provisionados ficam no checkout do build; builds seguintes localizam o mesmo D1 pelo nome. Se você informar um `database_id` próprio em `wrangler.jsonc`, ele será usado em vez da criação automática.

**O botão provisiona a aplicação, não suas contas externas nem a política de login.** Sem autenticação configurada, o app nega acesso aos dados. Workers Builds pode publicar novos commits automaticamente; GitHub Actions de deploy é uma alternativa manual, não precisa ativar ambos.

## 2. Login simples com Cloudflare Access

Não precisa criar OAuth Google para usar este caminho.

1. Em **Zero Trust → Access → Applications**, crie uma aplicação **Self-hosted** para o hostname do app.
2. Configure login por código de e-mail ou seu provedor corporativo e uma política **Allow** restrita aos e-mails/grupos autorizados.
3. Copie o **AUD** da aplicação e o endereço da equipe, como `https://sua-equipe.cloudflareaccess.com`.
4. Em **Workers & Pages → seu Worker → Settings → Variables and Secrets**, defina:

   | Variável | Valor |
   | --- | --- |
   | `AUTH_MODE` | `access` |
   | `AUTH_ORIGIN` | URL HTTPS exata, sem caminho |
   | `CF_ACCESS_TEAM_DOMAIN` | `https://sua-equipe.cloudflareaccess.com` |
   | `CF_ACCESS_AUD` | AUD copiado da aplicação Access |
   | `AUTH_BOOTSTRAP_EMAIL` | Seu e-mail de primeiro administrador |

5. Entre com esse e-mail. O app cria seu cadastro administrativo. Confira em **Equipe** e aprove os demais membros quando necessário.

O template usa `keep_vars: true`: variáveis de login cadastradas no painel são preservadas nos próximos deploys. Se você passar a declará-las em `wrangler.jsonc`, os valores do arquivo prevalecem. Nunca publique com `AUTH_MODE=dev`.

Proteja **todos** os hostnames: também `workers.dev`, ou desative-o ao usar domínio próprio. Previews ficam desligados por padrão. JWT inválido ou ausente não libera dados, e entrar pelo Access não transforma qualquer usuário em admin. Veja [detalhes e teste de segurança](docs/login-cloudflare.md).

## 3. Habilitar armazenamento seguro das integrações

Uma única chave mestra protege os segredos guardados pelo app. No painel do Worker, adicione um **Secret** chamado `INTEGRATION_SECRET_KEY`, com 32 bytes aleatórios ou mais. Gere o valor localmente, por exemplo com `openssl rand -hex 32`, e cole somente no campo secreto do painel.

Alternativa pelo terminal, depois de clonar o seu repositório e entrar com `npx wrangler login`:

```sh
npm ci
npm run setup:integration-secret
```

O script gera a chave e a envia diretamente ao Wrangler, sem imprimir nem salvar em arquivo. Confirme o Worker/conta de destino. **Não execute novamente para uma instalação já configurada**: trocar essa chave impede decifrar credenciais antigas até reconfigurá-las. Faça backup seguro e controle de acesso da instalação; não grave chaves em Git.

## 4. Composio e Z-API dentro do app

Abra **Configurações → Integrações**. Os tokens dos provedores são informados ali, não em arquivos nem em variáveis de deploy.

### E-mail e agenda pelo Composio

- O administrador informa a API key do projeto. O app prepara Auth Configs gerenciados; IDs existentes podem ser informados na opção avançada.
- No Composio, configure a verificação de identidade no retorno para `https://SEU_HOST/api/composio/callback`. Esse vínculo é necessário para ativar contas com segurança.
- Cada membro clica em **Conectar conta** e autoriza sua própria conta Google/Microsoft. A API key não substitui esse consentimento.
- A versão inicial oferece consultas de leitura; não envia e-mails nem cria eventos automaticamente. A integração Google Agenda/Meet direta continua disponível separadamente.

### WhatsApp pela Z-API

- O administrador informa instância e tokens no formulário e ativa o recebimento.
- Copie a URL de webhook gerada pelo app para o painel da Z-API e vincule o número por QR conforme o provedor.
- Associe explicitamente grupos/números aos clientes. O banco próprio passa a guardar texto e metadados das mensagens novas, com deduplicação.
- Retém mensagens por 90 dias. Não importa histórico anterior à ativação, não envia mensagens e não arquiva mídia neste primeiro corte. Mídia aparece indicada com legenda, nome/título do arquivo, MIME, duração e dimensões/quantidade de páginas quando disponíveis. Esses campos também ficam em `attachment` nas mensagens retornadas; áudio indica se é nota de voz. Não são guardados URLs, miniaturas, tokens ou arquivos binários. Não há transcrição/OCR nem integração Meta. Não dependa do link do provedor como arquivo permanente. A migração aditiva `0046` mantém mensagens antigas inalteradas, sem reconstruir metadados que nunca foram capturados.
- **Cloudflare Access:** crie uma exceção somente para o caminho exato desse webhook. A Z-API não consegue passar pelo login interativo. O app exige segredo exclusivo e valida a instância; não abra `/api/*` nem o app inteiro.
- A base Supabase continua alternativa para quem já a utiliza. Configure apenas grupos consentidos; defina sua política de retenção/eliminação e responsabilidades LGPD antes de capturar conversas.

## Alternativa: login Google direto

Crie OAuth Web Client no Google Cloud, callback `https://SEU_HOST/api/google/callback`. Configure no Worker `AUTH_MODE=google`, `AUTH_ORIGIN`, `AUTH_GOOGLE_DOMAIN`, `AUTH_BOOTSTRAP_EMAIL`, `GOOGLE_CLIENT_ID` e os secrets `GOOGLE_CLIENT_SECRET` e `GOOGLE_TOKEN_KEY` (aleatório forte). Entre com o e-mail administrativo indicado. Este login é independente do conector Composio.

Para Agenda/Meet direto, habilite `GOOGLE_ENABLED=true` e as permissões necessárias. Para IA, configure `AI_ENABLED`, seu gateway/modelo e os secrets próprios. Para Supabase, configure `WHATSAPP_ENABLED=true`, URL, tabela/colunas e `SUPABASE_SERVICE_KEY`. Integrações opcionais ficam desligadas quando ausentes.

## Desenvolvimento e deploy pelo terminal

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Use Node.js 24. `.dev.vars` é ignorado pelo Git. Para testar conectores localmente, adicione uma chave mestra **local** em `.dev.vars`; callbacks externos exigem HTTPS público/túnel. Não reutilize tokens de produção em demonstrações.

```sh
npm run check
npm run build
npx wrangler login
npm run deploy
```

O deploy altera recursos reais da sua conta. Revise o Worker, banco e conta antes de executar; faça backup antes de migrar banco com dados. O script atualiza `wrangler.jsonc` com IDs, preservando a configuração funcional (comentários JSONC podem ser normalizados).

O workflow GitHub `check` valida pushes/PRs. O deploy por Actions é manual e requer o environment `production`, secret `CLOUDFLARE_API_TOKEN` e variável `CLOUDFLARE_ACCOUNT_ID`, todos da sua conta.

## O que foi e não foi validado

Testes locais e builds verificam o código e o empacotamento. Sem suas contas/chaves não é possível atestar consentimento real Google/Microsoft ou entrega real de webhook Z-API. Ao instalar, teste login, isolamento dos usuários e uma conversa consentida antes de usar com dados reais.

Referências: [botão de deploy](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [provisionamento automático](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning), [migrações D1](https://developers.cloudflare.com/d1/reference/migrations/).
