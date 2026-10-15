# OAuth pessoal da API e do MCP

A autorização pessoal usa `@cloudflare/workers-oauth-provider`, sem uma implementação própria de códigos, PKCE, tokens ou refresh. O login Google existente identifica a pessoa; uma página separada pede consentimento para os escopos do aplicativo. O membro precisa estar ativo: o bootstrap administrativo não concede uma conexão OAuth.

## Recurso e descoberta

O recurso canônico é `https://<host>/mcp`. Ele identifica **o servidor de operações inteiro**, acessível por MCP e por `/api/v1`; não representa exclusivamente o caminho HTTP de uma ferramenta. Um token emitido para esse recurso pode chamar a API REST com os escopos consentidos. Isso também permite que o adaptador MCP encaminhe internamente uma operação para REST sem trocar audiência. Tokens de outro host, recurso ou workspace são recusados.

- `/.well-known/oauth-protected-resource/mcp`: recurso e servidor autorizador.
- `/.well-known/oauth-authorization-server`: endpoints e capacidades.
- `/oauth/register`: registro dinâmico de aplicativos compatíveis.
- `/oauth/authorize`: identidade e consentimento explícito em português.
- `/oauth/token`: troca, refresh e revogação implementados pela biblioteca.
- `/oauth/grants`: lista e revogação das conexões da pessoa.

PKCE S256 é obrigatório, fluxo implícito é desligado e o recurso é fixado. Acesso dura 15 minutos; refresh, até 30 dias. Registro dinâmico expira em 90 dias. CIMD só é anunciado no Worker quando o runtime confirma `global_fetch_strictly_public`; no Node local, usa-se registro dinâmico. O cadastro de um aplicativo não lhe concede acesso.

## Persistência e revogação

A porta KV usada pela biblioteca é implementada sobre D1 (`oauth_provider_kv`, migration 0015), isolada por workspace. Isso permite usar o mesmo fluxo em Next dev e no Worker sem criar um namespace KV externo. Nenhum protocolo OAuth é implementado pelo adaptador de armazenamento.

Cada alteração ou remoção de grant/aplicativo e o avanço da versão `ontology.oauthauth.v1` ocorrem no mesmo batch. Comandos que já leram uma versão anterior não podem confirmar depois dessa revogação. Em cada operação, o servidor relê grant, aplicativo, escopos, membro e alocações. `unwrapToken` sozinho não basta, pois usa uma cópia do grant que acompanha o token.

Operações duráveis guardam uma referência ao grant, usuário e aplicativo, com os escopos originalmente concedidos. Não guardam access/refresh tokens no principal. Webhooks podem revalidar essa referência após reinício e param quando a conexão ou o acesso é revogado.

A identidade OAuth pessoal pode agendar reuniões no Google com a conexão da própria pessoa, dentro das permissões existentes. Credenciais de sistema permanecem independentes e não herdam delegações pessoais.

## Ponte com Next

A biblioteca importa `WorkerEntrypoint` para identificar handlers de classe. Nossa integração usa somente handlers oficiais no formato objeto (`ExportedHandler`). `next.config.ts` resolve esse import para uma classe mínima no host Node; ela não implementa RPC, autenticação nem protocolo. Os testes Node usam a mesma resolução. Quando a integração precisar de handlers de classe/RPC, essa ponte deverá ser substituída pelo runtime Worker real.

No desenvolvimento, aplique `npm run db:migrate:local`. Não é necessário provisionar KV nem publicar para testar consentimento e tokens em localhost. A migração remota continua parte do fluxo normal de deploy autorizado.

O retorno do login Google só muda quando há um cookie de autorização OAuth pendente: nesse caso abre `/oauth/resume`, que relê a solicitação com prazo de dez minutos. O consentimento é vinculado à sessão da pessoa, ao navegador, à origem e a um nonce de uso único. URLs e nomes fornecidos pelo aplicativo são escapados na página, que recusa frames e scripts.

## Clientes que omitem escopos

Quando a requisição não traz `scope` (ou traz vazio), o consentimento oferece **Somente leitura** e **Consultar e operar**. A primeira opção vem selecionada; o POST exige uma escolha válida, vincula-a ao nonce original e calcula os escopos no servidor. Leitura inclui todos os escopos `:read`; operar inclui o conjunto suportado, sempre limitado pela matriz de permissões atual. Solicitações com escopos explícitos mantêm as caixas individuais e não podem ampliar seu conjunto. Grants anteriores não mudam: é necessário reautorizar. A renovação mantém o conjunto aprovado.
