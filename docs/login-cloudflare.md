# Login com Cloudflare Access

Não é necessário criar um cliente OAuth Google para usar este modo. O Cloudflare Access cuida do login (inclusive código por e-mail ou provedores corporativos); o Ontology valida o JWT assinado e mantém as permissões próprias da plataforma.

## Primeiro acesso

1. Publique o Worker e aplique as migrações seguindo [DEPLOY.md](../DEPLOY.md). Enquanto `AUTH_MODE=none`, o acesso aos dados permanece fechado.
2. No painel **Cloudflare Zero Trust → Access → Applications**, crie uma aplicação **Self-hosted** para o hostname real do app. Configure uma política **Allow** limitada ao seu e-mail administrativo ou ao grupo autorizado; não use uma política pública.
3. Copie o **Application Audience (AUD)** da aplicação e o domínio da equipe, como `https://sua-equipe.cloudflareaccess.com`.
4. Nas variáveis do Worker e na configuração usada nos próximos deploys, defina:

   | Variável | Valor |
   | --- | --- |
   | `AUTH_MODE` | `access` |
   | `AUTH_ORIGIN` | Origem HTTPS exata do app |
   | `CF_ACCESS_TEAM_DOMAIN` | `https://sua-equipe.cloudflareaccess.com` |
   | `CF_ACCESS_AUD` | Audience da aplicação Access |
   | `AUTH_BOOTSTRAP_EMAIL` | E-mail do primeiro administrador |

5. Entre pelo hostname protegido usando esse e-mail. O app cria seu próprio cadastro administrativo no primeiro acesso. Depois confirme o cadastro em **Equipe**. Novos membros continuam sujeitos à aprovação no app.

O Access reconhece a identidade; ele **não concede automaticamente** o papel de administrador. Antes da inicialização, somente `AUTH_BOOTSTRAP_EMAIL` pode iniciar o workspace. Membros inativos ou ainda não aprovados não recebem dados do workspace.

## Todos os hostnames precisam estar protegidos

Proteja também o endereço `workers.dev` ou desative-o ao adotar domínio próprio. Faça o mesmo com URLs de preview, ou desative os previews. Validação de JWT no servidor é uma defesa adicional, não motivo para deixar uma rota alternativa sem política.

## Webhooks e clientes externos

Z-API é um servidor externo e não consegue fazer o login interativo do Access. Ao ativá-la, siga as instruções do formulário e crie uma exceção **somente para o caminho exato do webhook** mostrado no app. O webhook exige um segredo aleatório independente, valida a instância e deduplica mensagens. Nunca use Bypass para `/api/*` ou para a aplicação inteira. Não compartilhe a URL do webhook em tickets ou repositórios públicos.

API/MCP e OAuth possuem autenticação própria. Se um cliente externo precisar acessá-los sem a sessão Access, configure políticas específicas para esses endpoints, mantendo a autenticação e a autorização do Ontology. Não abra outras rotas de dados como atalho.

## Teste de segurança

- Sem login, a página deve solicitar o Access; uma chamada direta não deve retornar dados.
- Sem JWT válido (assinatura, issuer, audience e expiração), a API recusa a identidade.
- Entrar com outro e-mail não deve permitir inicializar um workspace vazio.
- Um usuário fora do cadastro pode ver sua própria identidade/pendência, não os dados dos clientes.
- Ao sair pela tela de login, o app usa o logout do Access.
