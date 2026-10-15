# Permissões e acesso

Definido em 15/09/2026. Quatro níveis, uma matriz, uma função `can` usada pela interface (mostrar ou esconder) e pelo servidor (recusar gravações). Código em `src/modules/workspace/domain/permissions.ts`; testes em `tests/permissions.test.mjs`.

## Níveis

| Nível | Quem é | Resumo |
| --- | --- | --- |
| Admin da plataforma | Quem cuida da ferramenta | Vê e faz tudo: equipe, aprovações, catálogo, clientes, configurações e integrações. |
| Gestor de IA | Gestão da operação | Vê tudo; edita qualquer cliente, o catálogo e a alocação. Não gerencia a equipe nem as configurações do workspace. |
| AI Master | Quem entrega | Vê todos os clientes; edita só os clientes onde está alocado (responsável, CS ou equipe). |
| Visualização | Diretoria, apoio, auditoria | Consulta tudo, sem editar nada. |

Registros antigos com `access: "membro"` são lidos como AI Master. Um nível desconhecido é lido como Visualização.

## Matriz

Legenda: **tudo** · **alocado** (só nos clientes onde a pessoa está alocada) · **não**.

| Ação | Admin | Gestor de IA | AI Master | Visualização |
| --- | --- | --- | --- | --- |
| Ver todos os clientes | tudo | tudo | tudo | tudo |
| Criar cliente | tudo | tudo | não | não |
| Configurar cliente (serviço, plano, módulos) | tudo | tudo | alocado | não |
| Arquivar ou encerrar cliente | tudo | tudo | não | não |
| Marcar alertas do cliente como vistos | tudo | tudo | alocado | não |
| Plano e marcos do cliente | tudo | tudo | alocado | não |
| Ciclos e aceite | tudo | tudo | alocado | não |
| Entregas e solicitações | tudo | tudo | alocado | não |
| Editar a ontologia do cliente | tudo | tudo | alocado | não |
| Registrar interações e notas | tudo | tudo | alocado | não |
| Agendar e editar reuniões | tudo | tudo | alocado | não |
| Enviar e revisar documentos | tudo | tudo | alocado | não |
| Stakeholders do cliente | tudo | tudo | alocado | não |
| Catálogo: produtos e planos | tudo | tudo | não | não |
| Alocar clientes a AI Masters (carteira) | tudo | tudo | não | não |
| Cadastrar, aprovar e desativar membros | tudo | não | não | não |
| Configurações e integrações do workspace | tudo | não | não | não |
| Consultar a auditoria do workspace | tudo | não | não | não |
| Conectar a própria conta Google | tudo | tudo | tudo | não |
| Ver como outro membro | tudo | não | não | não |

"Alocado" para o AI Master significa: a pessoa é responsável, CX ou está na equipe geral/específica de alguma contratação daquele cliente. É a alocação, feita por gestores e admins, que abre a edição do cliente inteiro. O escopo por contratação organiza a responsabilidade operacional; não restringe autorização por produto.

Fila global de alertas (`/alertas`, contador do menu e "Precisa de atenção" da Visão geral): Admin e Gestor de IA veem todos os clientes; AI Master e Visualização veem só os clientes em que estão alocados (`seesAllAlerts` em `domain/alert-scope.ts`). A fila de um cliente (página do cliente, `/alertas?cliente=…`, REST/MCP `alerts_list` com `company`) continua visível para todos. "Marcar como visto" é por pessoa: tira o alerta só da fila de quem marcou; para o resto da equipe ele continua aberto.

## Autenticação e aprovação

- Publicado: o login é pelo Google via Cloudflare Access. O servidor verifica o JWT em toda chamada. Ninguém cria senha na plataforma.
- Primeira pessoa a entrar num workspace vazio vira Admin da plataforma (bootstrap). A partir daí, quem entra e não está no cadastro fica em **Aguardando aprovação**: vê só essa tela, e nenhum documento além do cadastro é entregue a ela.
- Aprovação: em Equipe, os admins veem quem entrou (lista de `users` do banco) e aprovam escolhendo o nível. A pessoa passa a ver o workspace na hora.
- Desenvolvimento local (`AUTH_MODE=dev`): a tela `/entrar` escolhe quem você é entre os membros com e-mail, ou um e-mail novo para testar a aprovação. A escolha vai num cookie lido só nesse modo.

## O que o servidor recusa hoje

Os dados vivem em documentos por contexto no D1 (`ontology.<contexto>.vN`). O servidor lê o cadastro no documento do workspace e aplica, por documento:

| Situação | Leitura | Gravação |
| --- | --- | --- |
| Workspace sem membros (bootstrap) | libera | libera |
| E-mail fora do cadastro | só o documento do workspace | recusa |
| Membro desativado | recusa | recusa |
| Visualização | libera | recusa |
| AI Master | libera | recusa no catálogo; libera nos demais |
| Gestor de IA | libera | recusa mudanças na equipe e no nome do workspace |
| Admin | libera | libera |

Limite conhecido: dentro de um documento como `ontology.delivery`, o servidor ainda não sabe a qual cliente pertence cada mudança, então a regra "AI Master edita só onde está alocado" é aplicada pela interface, não pelo servidor. Fechar isso pede uma das duas coisas: comparar o documento recebido com o gravado e identificar o cliente de cada registro alterado (viável, o documento tem `company` em quase tudo), ou normalizar os contextos em tabelas por entidade. A primeira é o próximo passo; a segunda fica para quando houver relatórios ou integrações que exijam consulta por linha.

## Próximos passos

1. Diff por cliente nas gravações de `delivery`, `engagement`, `documents`, `knowledge`, `relationship` e `stakeholders`, recusando mudanças em clientes onde o AI Master não está alocado.
2. Trilha: gravar `updatedBy` por registro (já existe `createdBy` e `history` em entregas e notas) e um log de recusas do servidor.
3. Tela de matriz em Configurações, lida de `permissionMatrix`, para o admin ver as regras sem abrir o código.

### Chaves pessoais da API

Os quatro níveis podem gerar e revogar suas próprias chaves em Configurações → API (`api-keys.gerenciar`). Isso não permite editar clientes nem ampliar acesso: cada chamada continua aplicando o nível e as alocações atuais do usuário. Visualização usa a API em leitura; AI Master só escreve onde alocado. Gestão pessoal não lista nem revoga chaves de outras pessoas. A administração de credenciais de serviço existente continua restrita a admin.
