# Operação por API, MCP e eventos

Este guia descreve os contratos e padrões da API REST e do MCP. Consulte implementação e testes para confirmar recursos disponíveis.

## Entradas e identidade

- REST: `/api/v1`. Contrato autenticado: `GET /api/v1/openapi.json`.

- OAuth: discovery em `/.well-known/oauth-authorization-server` e `/.well-known/oauth-protected-resource`; autorização em `/oauth/authorize`, consentimento explícito com a sessão da plataforma, PKCE S256. O recurso canônico de toda a superfície de operações é `https://<host>/mcp`, também ao usar REST com o token concedido. Escopos não elevam o nível nem a alocação do membro.
- Chaves pessoais: Configurações → API permite a cada membro ativo gerar, copiar uma vez e revogar suas chaves. `POST /api/v1/api-keys` recebe `{name, expiresInDays}` (30, 90 ou 365); GET lista somente chaves próprias e DELETE `/{id}` revoga. Gestão exige sessão, não Bearer. As chaves seguem nível/alocações atuais; não concedem acesso adicional. O dono e os escopos são derivados no servidor. Credenciais administrativas anteriores continuam compatíveis.
- Guia para pessoas e automações: `GET /api/v1/docs` (alias `/doc`) retorna `{data:{instructions,sections,saleExample,curlExample,baseUrl,openApiUrl}}`. Exige autenticação como os outros endpoints. O mesmo guia está na aba API, com instruções copiáveis e exemplo de venda composta.
- Credenciais de serviço: admin em sessão chama `POST /api/v1/credentials` com `name`, `ownerEmail`, `scopes`, `expiresAt` e, opcionalmente, `companies`. O token `api_…` só aparece na emissão; o banco guarda seu hash. `GET /api/v1/credentials` lista metadados; `DELETE /api/v1/credentials/{id}` revoga. Não colocar tokens em URLs, logs ou arquivos versionados.
- Google Agenda continua sendo uma conexão pessoal separada. Uma credencial de sistema não herda automaticamente autorização para enviar convites como pessoa; o consentimento OAuth pessoal é o caminho para isso.


Escopos seguem `domínio:read`/`domínio:write`: `clients`, `stakeholders`, `enrollments`, `delivery`, `meetings`, `catalog`, `events`, `documents`, `engagement`, `knowledge`, `workspace`. A existência de um escopo não significa que todo o domínio já tenha comandos publicados. O catálogo de ferramentas e o OpenAPI registram as operações disponíveis.

Cada requisição revalida membro ativo, nível, alocações, validade/revogação e escopos. O cadastro inicial de administradores não concede bootstrap a integrações. Respostas para integrações contêm entidades autorizadas; snapshots completos destinados ao cache da interface não são expostos a tokens com escopo de cliente.

## Operações e concorrência

`POST /api/v1/commands` recebe:

```json
{
  "command": "clients.create",
  "input": {
    "client": {"slug": "cliente-exemplo", "name": "Cliente exemplo", "startedAt": "2026-10-01"},
    "config": {"productIds": ["id-do-produto"]},
    "stakeholders": [{"name": "Contato exemplo", "role": "Diretor", "emails": ["contato@example.com", "financeiro@example.com"], "phones": ["+55 11 99999-9999"], "primary": true}],
    "externalReference": {"system": "crm", "kind": "sale", "externalId": "venda-exemplo"}
  }
}
```

Enviar `Authorization: Bearer <token>` e `Idempotency-Key: <UUID da intenção>`. A mesma intenção após timeout usa **a mesma chave e o mesmo corpo**. Alterar o pedido exige chave nova. Uma chave é única por workspace e principal, não por comando. Reutilização incompatível resulta em `409 idempotency_conflict`. Referência externa repetida com outra chave recupera o resultado original quando o pedido é idêntico; conteúdo divergente produz conflito.

A interface envia também `expectedVersions` por documento. `409 version_conflict` (ou `412` na precondição de execução) não é sucesso: atualizar os dados antes de reenviar a alteração. O commit verifica as versões atuais de documentos escritos e dependências de autorização, incluindo mudanças de equipe durante a requisição. Recibo, documentos, histórico, referências, eventos e auditoria operacional são gravados no mesmo batch D1.

Para comandos de tarefa, ciclo e plano de um cliente, REST aceita opcionalmente o cabeçalho `x-client-snapshot` com o `clientSnapshot` retornado pela lista desse cliente (`geração:encarnação:revisão`). MCP expõe `expectedClientSnapshot` no mesmo conjunto de ferramentas. Em `active`, um comando compatível confirma só a fatia do cliente e devolve `clientSnapshot` com a revisão seguinte; quando altera somente execução, `documents` fica vazio inclusive para a sessão da interface. O avanço de marco de uma contratação grava `clients.v3` sob guarda da fatia, devolve esse documento para a sessão e mantém o `clientSnapshot`, pois a execução não mudou. `409 snapshot_changed` exige recarregar o cliente, e `409 scoped_command_unavailable` indica que o gesto ainda requer o fluxo documental legado. Repetir uma resposta incerta exige a mesma chave de idempotência e a mesma intenção. Sem o marcador, a interface mantém o contrato documental atual. A disponibilidade de cada fluxo depende da implementação e configuração do ambiente.

Toda mutação confirmada que produz evento grava uma linha permanente em `client_audit_log`, nome histórico da trilha operacional do workspace. A linha contém comando, ação, área, entidade, cliente quando houver, ator humano (`memberId` e e-mail), principal/aplicação técnicos, horário, contexto mínimo e origem confiável `interface`, `api` ou `mcp`. Ela não participa da poda de 90 dias de `operation_events`; retry idempotente e operação sem mudança não duplicam linhas. `GET /api/v1/clients/{company}/audit-log` e MCP `clients_audit_log` consultam um cliente sob `clients:read`. `GET /api/v1/admin/audit-log` e MCP `admin_audit_log` oferecem a visão global, exclusiva de Admin da plataforma com `workspace:read`, filtros por cliente, ator, origem e área. A consulta aceita paginação por cursor para integrações ou `page` para tabelas numeradas. O modo numerado começa em `page=1`, devolve `total`, `totalPages` e um `anchor` opaco obrigatório nas páginas seguintes para que novos logs não desloquem a listagem; cursor e página não podem ser combinados. O backfill aproveita apenas eventos ainda retidos; registros antigos não distinguem MCP de REST e podem não possuir e-mail de sessões históricas.

Cadastro/configuração de cliente são operações compostas. A interface aguarda a confirmação antes de fechar, bloqueia duplo envio e preserva a identidade de retries incertos. O modo local continua existindo; falha de rede não ativa esse modo automaticamente.

## Contratações e stakeholders

`enrollments.create` recebe `company`, `productId`, `startsAt`, opcionalmente `productVersion`, `previousEnrollmentId` e `externalReference`. Cada compra tem ID, início e cópia de execução próprios, inclusive quando o produto é o mesmo. A versão exata do produto é a única fonte de ciclos e tarefas; o plano privado criado é uma fotografia operacional, nunca um modelo global selecionado por associação. Ciclos/tarefas carregam `enrollmentId`. IDs anteriores permanecem intactos.

No modo de execução `active`, a compra de um cliente existente confirma cadastro e execução por cliente na mesma transação. A resposta de sessão pode trazer apenas `clients.v3` em `documents`; consulte `GET /api/v1/clients/{company}/execution-snapshot` ou MCP `clients_execution_snapshot` para obter a execução atualizada. O contrato de `data.enrollment`, idempotência, referência externa e precondição explícita `expectedVersions['ontology.delivery.v2']` permanece igual. `409 version_conflict` após concorrência exige nova leitura antes de uma nova intenção.

Vínculos legados sem execução podem ser materializados ao configurar o cliente. Uma execução legada inequívoca é adotada preservando IDs, datas e histórico. Dados ambíguos são recusados para classificação explícita. A migração não atribui a versão atual a uma compra histórica desconhecida.

O ciclo de vida usa os mesmos comandos em REST e MCP: `enrollments.update` exige `reason` ao cancelar e registra situação, autor e data, além de `enrollment.cancelled` explícito na auditoria; `enrollments.archive` aceita somente concluída/cancelada; `enrollments.restore` desfaz o arquivo; `enrollments.rebuild` substitui uma execução intacta pela versão contratada; `enrollments.remove` apaga apenas cadastro acidental com execução intacta e sem reunião ou referência externa, inclusive referência externa na venda que originou a contratação. Os quatro últimos têm aliases `POST /clients/{company}/enrollments/{id}/{archive|restore|rebuild|remove}`; remoção e reconstrução exigem também `delivery:write`. Contratações canceladas ou arquivadas não recebem novas tarefas, ciclos, preparação, reprogramação, rollout ou alterações de participantes. Entidades apagadas ficam protegidas por tombstones relacionais atômicos, evitando referências externas órfãs mesmo sob concorrência.

`stakeholders.save` cria/edita a pessoa no cliente; `members.create/update` fazem o mesmo para a equipe interna. Ambos aceitam `emails` e `phones` com até dez itens cada. O primeiro item é o principal e também aparece nos aliases legados `email` e `phone`; enviar o array substitui a lista inteira, enquanto enviar apenas o campo singular troca o principal e preserva os adicionais. O primeiro e-mail de um membro continua sendo sua identidade de acesso — adicionais são somente canais de contato. E-mails são comparados sem diferença de caixa e telefones por número normalizado. Nenhum e-mail ou telefone pode pertencer a duas pessoas no workspace, mesmo entre equipe e clientes, clientes diferentes ou registros inativos. A validação lê e guarda as versões dos dois documentos, portanto gravações concorrentes não furam a unicidade. Registros antigos recebem os arrays por migração preguiçosa; não há alteração de tabela D1.

`participants.save` liga a pessoa à contratação e guarda papel, postura, influência e principal locais. Um principal de produto não muda o principal geral. Contatos de outro cliente ou inativos não podem ganhar participação ativa. Inativação preserva histórico.

## Venda composta e consultas de contexto

`POST /api/v1/sales` ou MCP `sales_register` executa `sales.register`. Exemplo de corpo REST (o MCP recebe o mesmo corpo em `input`, mais `idempotencyKey`):

Quando `client.id` indica um cliente existente e a autoridade de execução está em `active`, uma venda com uma ou várias contratações usa a fatia desse cliente. Cadastro, contatos, participantes, planos privados e referências externas são confirmados juntos; a resposta de sessão pode omitir `ontology.delivery.v2` em `documents`. Após confirmar, consulte a execução por cliente para obter os ciclos e tarefas atuais. A venda que cria um cliente novo continua usando o caminho documental completo.

```json
{
  "client": {"create": {"slug": "cliente-exemplo", "name": "Cliente exemplo", "startedAt": "2026-10-01"}},
  "externalReference": {"system": "crm", "externalId": "venda-123"},
  "contacts": [{"ref": "ana", "stakeholder": {"name": "Ana", "role": "Diretora"}, "externalReference": {"system": "crm", "externalId": "contato-456"}}],
  "enrollments": [
    {"ref": "primeira", "productId": "produto-exemplo", "startsAt": "2026-10-01", "participants": [{"stakeholderRef": "ana", "accountRole": "patrocinador", "primary": true}]},
    {"ref": "segunda", "productId": "produto-exemplo", "startsAt": "2026-12-01", "participants": [{"stakeholderRef": "ana", "accountRole": "ponto-focal", "primary": true}]}
  ]
}
```

Para cliente existente, use `client: {id: "cliente-exemplo"}`; não envia cadastro nem altera alocação. `client.create` e `client.id` são alternativas explícitas, inclusive no retry. A venda preserva plano acompanhado, marco e versão fixada de um cliente existente, inclusive quando não há seleção explícita. Para cliente novo, a primeira contratação fornece o plano inicial, no marco 1 e sem versão fixada. Cada contratação exige início próprio; não há materialização paralela por `config.productIds`. Máximos: 100 contatos, 20 contratações, 100 participantes por contratação e 200 participações no pedido.

Cada contato tem `ref` local e usa `stakeholderId`, dados em `stakeholder` ou uma referência externa já conhecida. Participantes usam exatamente `stakeholderId` ou `stakeholderRef`. Referências locais não se repetem dentro de seu tipo. Não há fusão automática por nome/e-mail. Um contato externo já conhecido pode ser reutilizado em outra venda do mesmo cliente; dados enviados explicitamente atualizam o cadastro geral autorizado.

REST e MCP validam o mesmo schema de venda antes de executar: campos desconhecidos em contatos e referências externas são recusados, evitando que erros de digitação sejam ignorados. Tipos externos são fixados pela posição: `sale`, `client`, `stakeholder`, `enrollment`. Referência da venda mais mesma intenção recupera o recibo mesmo com outra chave; conteúdo diferente retorna conflito. Referências de cliente/contato identificam entidades reutilizáveis; a da contratação não cria outra compra quando já estiver usada. Mapas retornados trazem as identidades efetivas e os principais finais. Todas as permissões das suboperações são verificadas antes do commit e novamente no replay. `sale.registered` e eventos de entidade só existem após o commit completo.

| REST | MCP | Conteúdo |
| --- | --- | --- |
| `GET /me` | `me_get` | Identidade, nível, scopes e recorte atual |
| `GET /capabilities?company=...` | `capabilities_get` | Permissões por ação/escopo; pré-condições continuam obrigatórias |
| `GET /clients/{id}/context` | `clients_context` | Contexto compacto com seções permitidas e indisponíveis explícitas |
| `GET /clients/{id}/stakeholder-map` | `clients_stakeholder_map` | Pessoas únicas, contagens e participação/lacunas por contratação |
| `GET /products/{id}/versions[/{version}]` | `products_versions` | Lista de versões ou definição escolhida; `current` segue a mesma seleção da contratação |
| `GET /admin/audit-log` | `admin_audit_log` | Auditoria operacional global; somente Admin da plataforma, com filtros e paginação por cursor ou página |
| `GET /allocations?memberId=...&role=responsavel` | `allocations_list` | Alocações do membro em todos os clientes autorizados; `totalClients` conta clientes distintos antes da paginação |

Para contar a carteira de um membro, obtenha o ID em `members_list` e consulte `allocations_list` com `memberId` e `role`. `company` continua disponível para ver a equipe de um cliente, incluindo vínculos históricos identificados por `from`/`to`; a consulta global por `memberId` considera vínculos vigentes em clientes e contratações atuais e exclui responsabilidade geral totalmente substituída por alocações específicas. O `leadId` e o `milestone` de `clients_list` são campos legados do cadastro; podem divergir das alocações e dos marcos das contratações. Para quebra por produto/marco, combine os vínculos retornados com `enrollments_list` e use `enrollment.milestone` (quando ausente, informe que o marco não está registrado). Uma alocação com `enrollmentId` se aplica apenas àquela contratação; uma alocação geral se aplica ao cliente inteiro.

`clients_list` aceita `memberId`, `role`, `productId`, `q`, `status`, `healthFlag` e `includeArchived=false` para reduzir a lista antes da paginação; cada registro inclui `archived`. `status` é a situação cadastral; `healthFlag` é o sinal de saúde, separado do `health` numérico. O MCP usa `view=summary` por padrão para evitar respostas grandes: `leadId`, `csId` e o marco legado não aparecem. REST mantém `view=full` por padrão; ambas as vias aceitam `view=summary|full`. Com alocação ou produto, restringe a clientes não arquivados. Ao combinar membro e produto, os dois filtros precisam corresponder à mesma contratação; responsável específico da contratação substitui o geral naquele papel. `members_list` aceita `company`/`role` para obter os membros da equipe do cliente. `enrollments_list` aceita `memberId`, `role`, `productId`, `milestone` e `currentOnly=true` para excluir contratações canceladas/arquivadas. Essas listas retornam `total` real antes da paginação; `enrollments_list` também retorna `totalClients` para clientes distintos. Um cliente com várias contratações pode entrar em mais de um marco. `limit=100` não significa que há 100 registros. O filtro de membro usa alocações vigentes. Para explorar um cliente, `clients_context` devolve alocações e contratações compactas, `unavailable` para seções não autorizadas e `links.related` para listas paginadas de equipe, contratações, stakeholders e documentos. No MCP, passe o mesmo `company` a `stakeholders_list` ou `documents_list` para obter as listas completas.

A seção `execution` de `clients_context` usa a fatia do cliente quando a geração de sombra coincide com as versões atuais de execução e cadastro; se ela estiver defasada, recua à leitura anterior. Os contadores, a autorização e `versions["ontology.delivery.v2"]` mantêm o mesmo contrato REST/MCP. A consulta não carrega o corpo global de execução quando a fatia está atual.

Em listas de clientes, contratações e alocações, guarde `snapshotVersion` da primeira página e envie `expectedVersion` nas páginas seguintes. Se o documento de clientes mudou, a API devolve `409 snapshot_changed`; reinicie pelo primeiro cursor. Esse controle impede completar uma contagem juntando páginas de versões diferentes. Cada consulta ainda é uma leitura independente: ao cruzar listas diferentes, compare suas versões.

Mapa de stakeholders exige `stakeholders:read` e `enrollments:read`. Cobertura de reuniões só aparece com `meetings:read`, usa `enrollmentIds` explícitos e convidados registrados; não comprova presença. Reuniões sem vínculo ficam gerais. Postura/influência locais não são preenchidas com os valores gerais para esconder lacunas. Sem perfil de papéis esperado no modelo, `expectedRoles` permanece `null`.

## Catálogo, preparação e atualização de compras

O catálogo visível contém somente Produtos; `/catalogo/planos` redireciona para Produtos. `GET /plans`, `plans_list`, `plans.save/publish/remove` e `plans.provision` permanecem como contratos de compatibilidade para clientes e integrações legadas. Eles não definem novas contratações. `products.save` versiona a definição completa do produto; planos privados de contratações ficam intactos.

`enrollments.provision {company,enrollmentId,prepared?}` prepara uma compra já existente, sem criar outra contratação. Usa início e versão conhecidos da compra; uma fotografia privada antiga ainda pode ser completada para preservar clientes atuais. `prepared` aceita os campos editáveis do rascunho de produto, não identidade/histórico. Preparação acrescenta ciclos ausentes e preserva integralmente ciclos existentes, removidos ou concluídos. `plans.provision {company,planId,enrollmentId:null}` atende somente plano automático legado atribuído ao cliente. Repetição sem novo trabalho não emite evento de preparação.

`POST /product-rollouts/preview` recebe `{company,enrollmentId,productId,targetVersion,cycleIds?}`; `enrollmentId:null` seleciona explicitamente o legado. Não exige chave idempotente pois é leitura. Retorna alterações por ciclo e `previewFingerprint` SHA-256 opaco. `POST /product-rollouts/apply` (ou comando `product-rollouts.apply`) acrescenta `cycleIds` não vazio e o fingerprint original, com chave idempotente. O servidor recalcula a prévia e recusa alterações concorrentes. A prévia exige `catalog:read`, `enrollments:read`, `delivery:read` e permissão de plano; aplicação usa `delivery:write`. Somente ciclos planejados futuros sem trabalho registrado podem mudar; compra vizinha, tarefas personalizadas/concluídas, evidências e remoções explícitas são preservadas. Baseline histórica desconhecida é recusada.

As telas mantêm rascunho e a mesma intenção após resposta perdida. PUT de catálogo e escrita de planos privados/versões fixadas por snapshots antigos retornam `409 operation_required`.

## Execução e datas

Comandos compatíveis com escrita por cliente validam a revisão da fatia e registram a operação de forma consistente. Operações legadas podem exigir leitura ou reconstrução mais ampla; consulte testes e implementação.

As listas de tarefas e ciclos por cliente podem usar paginação SQL sobre a projeção ligada à revisão da fatia. Se a projeção estiver ausente ou defasada, a mesma consulta volta à fatia autoritativa e mantém filtros e paginação. No modo `active`, a primeira página também devolve `clientSnapshot` (`geração:encarnação:revisão`). Envie esse valor como `expectedClientSnapshot` com `nextCursor` nas páginas seguintes; uma mudança de outro cliente não invalida a sequência, mas uma mudança na própria fatia devolve `409 snapshot_changed` com o novo marcador. `snapshotVersion`/`expectedVersion` continuam disponíveis como guarda da versão lógica global para clientes antigos.

`tasks.create/update/complete/comment/checklist/blocker/remove` e `cycles.save/remove` cobrem formulários, editor, lista e quadro. Conclusão combina edição, esforço, checklist e evidência em um commit; autoria e política vêm do servidor. `tasks.complete` aceita `completedAt` em `YYYY-MM-DD` como a data efetiva da conclusão, inclusive passada para migrações; a omissão usa a data atual do workspace e datas futuras são recusadas. O horário do audit log continua sendo gerado pelo servidor no instante real do registro, e seu contexto inclui `completedAt`, separando o fato de negócio da entrada na plataforma. Ao reabrir a tarefa, a data efetiva é limpa. No patch, `effortActual: null`, `startsAt: null` e `deliverable: null` removem os respectivos campos opcionais; omissão preserva o valor. A remoção persiste após recarga, inclusive sobre tarefas de seed. Campos obrigatórios não aceitam essa convenção. Em criação de tarefa (inclusive dentro de ciclo), esses campos devem ser omitidos quando ausentes: `null` é recusado, pois a remoção só se aplica à edição. Criação avulsa usa o plano efetivo do cliente sem inferir produto ou contratação.

`tasks.remove` (`tasks_remove`, `POST /tasks/{id}/remove`) exclui tarefas manuais e derivadas de modelo, com `entregas.remover` e `delivery:write`. Referências da base usam o mesmo marcador de remoção; o catálogo de origem permanece intacto. Um ciclo concluído ou outra tarefa com prazo dependente exige ajuste prévio. Remoção confirma um marcador reservado em `taskPatches`, retém o registro, histórico e documentos e desvincula dos ciclos abertos. A projeção omite tarefas removidas; versões antigas sem marcador conservam o comportamento anterior. O comando também funciona na fatia ativa do cliente.

Transferir responsabilidade usa `tasks.update` com somente `patch: {ownerId, assignmentSource: "manual"}`. A interface salva essa intenção separada dos demais campos, sem recalcular prazos legados; omitir `assignmentSource` na troca também registra a atribuição manual no servidor. O membro precisa estar ativo e a autorização continua sendo do cliente.

`plans.schedule` recebe `company`, `planId`, `enrollmentId` (ID da contratação; `null` seleciona a execução sem contratação), `cycles` e `tasks` com `{id, startsAt, endsAt}`. A omissão só permite inferência quando não houver ambiguidade: várias compras ou compra coexistindo com execução antiga exigem seleção explícita. IDs devem pertencer ao plano/contratação selecionado. No legado, o plano deve ser o atribuído ao cliente e a seleção usa o vínculo de jornada; o produto sozinho não comprova pertencimento. Datas concluídas, inclusive tarefas de ciclo concluído, não mudam. A interface mantém a base da edição depois de polling para que retry após resposta perdida não vire outra intenção. Vínculo de plano usa `clients.configure` com `client: {slug}`, `journeyId` e `milestone`, preservando alocações não enviadas.

## Reuniões e efeitos externos

`meetings.create`: `{meeting: {...}, sendInvites: true|false, timeZone?: string}`. Atualização e reagendamento recebem `{meetingId, patch}`; cancelamento recebe `{meetingId}`. Participantes, cliente, ciclos e contratações são validados no servidor; organizador e autoria vêm da identidade autenticada.

Antes de Google, o servidor persiste a reunião e a intenção externa. `pending`/`uncertain` indica que ainda há trabalho a confirmar; não significa que os convites não foram enviados. Repetir a intenção consulta/retoma o journal com identificação estável de evento. `GET /api/v1/operations/{id}` consulta; `POST /api/v1/operations/{id}/resume` retoma. A interface mantém o formulário aberto e oferece consulta de resultado enquanto houver pendência.

Edição Google usa controle de versão do evento; alterações externas concorrentes não são sobrescritas silenciosamente. Configuração de gravação que falha após criar o evento continua sendo aviso parcial. Nenhuma chamada real de convite faz parte dos testes automatizados.

## Ontologia por cliente

`knowledge_get` devolve por padrão um resumo com versão, contagens e até 25 domínios. Use `knowledge_elements_list`, `knowledge_connections_list` e `knowledge_domains_list` para ler em blocos: `limit` de 1 a 100 (padrão 25), `nextCursor` como `cursor` da próxima chamada, `q`, `domain`/`elementType` para elementos e `nodeId` para relações. As páginas trazem `snapshotVersion`; cursor de outro filtro é recusado e mudança do mapa retorna `409 snapshot_changed`. Detalhes completos usam `knowledge_element_get` (`nodeId`) ou `knowledge_connection_get` (`edgeId`). `view: "full"` inclui conteúdo completo; no resumo os textos extensos são omitidos. `includeDraft: true` só tem efeito na leitura completa.

REST oferece `GET /knowledge/{company}/{elements|connections|domains}` e detalhe por ID de elemento/relação. A raiz REST conserva a resposta completa e draft por compatibilidade; `?view=summary` ou `?includeDraft=false` reduzem a leitura. MCP e OpenAPI descrevem explicitamente os campos de nós, relações e domínios. Em edição de elemento, consulte seu detalhe e preserve os campos que devem continuar: salvar substitui o registro editável.

`knowledge_domains_save` cria ou edita domínios, inclusive domínios da base. `knowledge_graph_upsert` confirma domínios, elementos e relações em uma transação: até 100 por coleção e 200 registros no total. Pessoas responsáveis e extremidades podem ser criadas no mesmo lote, sem dependência da ordem. REST: `POST /knowledge/{company}/domains` e `POST /knowledge/{company}/graph/upsert`. IDs removidos não são recriados por save; restauração usa histórico.

As gravações MCP devolvem confirmação compacta (versões, contagens e até 25 IDs alterados por coleção). `responseMode: "full"` solicita o grafo e draft; REST conserva esse modo como padrão. `expectedVersion` opcional recusa escrita sobre revisão diferente. Depois de timeout, repita a mesma intenção e chave; após conflito, releia e crie outra intenção. Leituras exigem `knowledge:read` e acesso ao cliente; gravações exigem `knowledge:write` e `ontologia.editar`.

## Feed e webhooks

`GET /api/v1/events?cursor=<sequence>&limit=50&company=<slug>` exige `events:read`. Persistir `nextCursor` mesmo quando `data` vier vazio: o cursor pode ter avançado sobre eventos fora do escopo. `hasMore` indica continuação disponível. O feed é a via de reconciliação após interrupções de consumidores.

Admin pode cadastrar `POST /api/v1/webhooks` com `url` HTTPS pública, `types` (por exemplo `client.updated` ou `*`) e `company` opcional. Requer `events:write` e `events:read`, além da permissão de configurações. `GET` lista metadados e `DELETE /api/v1/webhooks/{id}` desativa. Mutações usam `Idempotency-Key`. O segredo `secret` retornado no cadastro deve ser guardado pelo receptor para verificar assinaturas.

`PATCH /api/v1/webhooks/{id}` altera `url`, `types`, `company` (`null` para retirar o filtro) ou `active` (pausar/retomar). A gestão é do proprietário autenticado, com permissões atuais; lease ativo ou revisão concorrente retorna conflito. Mudanças preservam cursor, segredo e histórico. Filtros atuais também se aplicam ao backlog pendente.

`GET /api/v1/webhooks/{id}/deliveries` lista entregas e até 100 tentativas recentes por entrega, com cursor. `POST /api/v1/webhooks/{id}/deliveries/{eventId}/replay` reenfileira entrega concluída ou esgotada de assinatura ativa, com `Idempotency-Key`. Mantém `eventId` e contador/histórico, concedendo até oito novas tentativas. Repetir a chave não reenfileira novamente. MCP: `webhooks_update`, `webhooks_deliveries_list`, `webhooks_delivery_replay`.

O cron distribui eventos em entregas persistidas, com lease, retries e entrega **pelo menos uma vez**. Desduplicar por `x-g4-event-id`. A assinatura é:

```text
x-g4-timestamp: <segundos Unix>
x-g4-signature: v1=<HMAC-SHA256(secret, timestamp + "." + corpo HTTP original), hexadecimal>
```

O receptor compara em tempo constante, rejeita timestamps antigos e só então interpreta JSON. Redirecionamentos não são seguidos. `global_fetch_strictly_public` impede acesso a destinos privados no Worker; validação de URL é adicional. O segredo persistido e o recibo de criação usam AES-GCM. Configure `INTEGRATION_SECRET_KEY` com 32 bytes aleatórios codificados em base64, somente em secrets/.dev.vars.

Depois de oito tentativas sem sucesso, a entrega fica `failed`, preservada para diagnóstico. O feed permite reconciliar o consumidor; não há garantia de ordem global entre entregas HTTP. Os eventos carregam versões dos documentos escritos, identificador da operação e referências compactas, não conteúdo integral do cliente.

## Preparação e validação

Aplicar migrations no ambiente escolhido antes de usar novas rotas. OAuth usa a biblioteca `@cloudflare/workers-oauth-provider` com adaptador de armazenamento D1; não requer inventar um ID KV. Manter segredos Google existentes para convites e configurar a chave de integração para webhooks. Sem essa chave, o feed continua disponível e webhooks recusam configuração/envio.

`npm run check` é o critério local; build Next/OpenNext e teste no runtime Worker complementam os testes SQLite. As verificações de navegador usam dados sintéticos ou mocks isolados, nunca convites ou clientes reais. A ativação em produção exige aplicar migrations e publicar o Worker conforme [DEPLOY.md](../DEPLOY.md).

Referências de protocolo: [MCP 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [SDK TypeScript v2 e compatibilidade](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28), [OAuth Provider da Cloudflare](https://github.com/cloudflare/workers-oauth-provider).

### Evidências desta entrega

- Check completo: lint, TypeScript e testes de domínio, SQLite, handlers, OAuth, transporte MCP e integrações simuladas.
- Build Next/OpenNext e Worker isolado: discovery OAuth, recusas de autenticação e SDK oficial nos protocolos legado e 2026-07-28.
- Navegador 1440/390 com handlers reais + SQLite isolado: cliente, duas compras do mesmo produto, principais distintos por contratação, reunião e ciclo. Resposta perdida após commit, retry idempotente, duplo envio e falha de inativação exercitados sem alterar dados reais.
- Codex nativo (`app-server`) em configuração temporária isolada: inicialização e `mcpServerStatus/list` descobriram 14 ferramentas via transporte HTTP, sem criar tarefa nem chamar modelo.
- Claude Code nativo em configuração temporária isolada: health check confirmou handshake (`initialize` e notificação), sem modelo. Esse comando não executa `tools/list` ou chamadas de ferramentas.
- OAuth no navegador: consentimento, PKCE, leitura REST e revogação seguida de 401.
- Revisão de código cruzada identificou e corrigiu permissões compostas no replay, allowlist vazia no feed, paginação fracionária e ETag nos adaptadores de reuniões.

Na revisão da fundação (commit `d6a8808`), o helper `autoreview --mode local --engine codex` não chegou a invocar o revisor: seu filtro classificou templates de geração de tokens e fixtures sintéticas como segredos. Os locais foram inspecionados, mas o filtro não foi desativado; esta execução não deve ser descrita como autoreview limpa. A evidência acima vem dos testes e da revisão cruzada efetivamente executados.

Na migração de execução, o revisor estruturado executou e apontou seleção de planos, metadados de cópia e remoção de campos; os casos comprovados foram corrigidos e testados. A alegação sobre perda de fila de conclusões foi refutada pelo host existente e por teste em navegador. A tentativa de fechamento foi invalidada por mudança posterior no código; a nova tentativa foi barrada pelo filtro ao incluir o teste sintético de compatibilidade OAuth. Portanto, não há resultado estruturado limpo para a árvore final. Checks, browser e conferência direta do código são evidências separadas.



### Converter uma ação de reunião em tarefa

`meetings.actions.createTask` (MCP `meetings_actions_create_task`) recebe `{meetingId, actionId, enrollmentId}`; o alias é `POST /api/v1/meetings/{id}/actions/{actionId}/task`, com `{enrollmentId}` e `Idempotency-Key`. O ID da contratação deve estar na reunião; use `null` explicitamente apenas quando a reunião não tiver contratações. Exige `meetings:write` e `delivery:write`, além das permissões atuais para agendar reuniões e editar tarefas no cliente.

A tarefa nasce aberta (`fila`), mesmo se a ação estiver marcada como feita; a conclusão continua seguindo as regras de tarefas. Tarefa e vínculo da ação são confirmados juntos, com recibo e eventos. Nenhum convite é enviado e nenhum ciclo recebe a tarefa automaticamente. Converter novamente a mesma ação retorna a tarefa vinculada; vínculos inconsistentes exigem revisão. Reuniões canceladas ou com operação de agenda pendente não aceitam nova conversão.

O vínculo `actions[].deliveryId` é controlado pelo comando composto: edição genérica preserva o vínculo existente e recusa adulteração. Ao editar ações de uma reunião que já tenha vínculos, envie os IDs retornados na consulta; posição no array não identifica a ação. Snapshots antigos sem IDs só preservam vínculos quando a sequência identificável permanece inalterada. Reuniões e ações com tarefas vinculadas não são excluídas por snapshots; os comandos de remoção/restauração preservam o histórico e os vínculos. A interface mantém intenção, chave e versões após resposta perdida. O fallback sem servidor preserva o fluxo local, mas não representa transação durável entre documentos do navegador.


### Sincronizar respostas de convites

`meetings.syncResponses` / MCP `meetings_sync_responses` recebe `{meetingId}`; `POST /api/v1/meetings/{id}/sync-responses` recebe `{}` e `Idempotency-Key`. Exige `meetings:write`, permissão para agendar no cliente e sessão/OAuth pessoal do organizador com Google conectado. Credenciais de sistema não delegam a agenda pessoal e não recebem essa ferramenta no catálogo MCP.

O servidor resolve calendário/evento a partir da reunião. Cache de 60 segundos e lease em D1 evitam consultas simultâneas; a data exibida é a coleta real, não o uso do cache. Após consultar o Google, relê a reunião e as permissões, confirma a identidade do evento e atualiza somente `google.responses`, `responsesAt` e `cancelled`, preservando notas, participantes e demais alterações concorrentes. Não adota o ETag do Google, não envia convites e não transforma cancelamento externo em exclusão local.

Uma tentativa repetida mantém chave e intenção. Nova chamada dentro do cache não produz evento ou nova versão se os dados já estiverem aplicados. Respostas antigas não substituem uma coleta mais recente. `responses` e `responsesAt` são campos de servidor no caminho de snapshots: omissão preserva o valor atual; alteração explícita é recusada.


## Importação de materiais do Meet

`meetings.syncArtifacts` / MCP `meetings_sync_artifacts` recebe `{meetingId}`; `POST /api/v1/meetings/{id}/sync-artifacts` recebe `{}` e `Idempotency-Key`. Exige sessão/OAuth pessoal do organizador conectado, `meetings:write` e `documents:write`, com as permissões correspondentes no cliente. Credenciais de sistema não recebem a ferramenta nem podem executar o comando.

A coleta respeita a seleção de sessão, paginação e completude de transcrição do adaptador Google. A busca manual usa cache curto de 60 segundos; a busca automática continua limitada a uma vez por hora e à janela de sete dias. Não cria nem reenvia convites. Materiais disponíveis dependem da conta e do processamento do Google.

A migração `0020_meeting_artifact_syncs.sql` deve estar aplicada antes de habilitar este comando. O resultado da coleta é preservado no R2 privado, referenciado pelo journal D1, para retomar a mesma intenção após falhas. O conteúdo da transcrição é imutável; metadados do arquivo, nova versão do documento, vínculo da reunião, recibo e evento são confirmados juntos no D1. Texto idêntico não cria outra versão; texto alterado preserva a versão anterior. A operação relê reunião e permissões antes de confirmar e mescla apenas seus campos, preservando notas e respostas dos convidados.

A página e a sincronização automática compartilham a tentativa pendente. Após perda de resposta, repetir verifica o mesmo recibo; revisar a busca inicia outra intenção. Snapshots antigos não podem modificar os campos de materiais: omissão preserva valores do servidor e alteração explícita é recusada. O modo local sem servidor mantém seu fluxo próprio.


## Remoção e restauração de reuniões e ações

`meetings.remove` recebe `{meetingId, keepCalendar?: true}`; `meetings.restore` recebe `{meetingId}`. `meetings.actions.remove` e `meetings.actions.restore` recebem `{meetingId, actionId}`. Os nomes MCP usam underscores; aliases REST são `POST /meetings/{id}/remove`, `/restore` e `/meetings/{id}/actions/{actionId}/remove` ou `/restore`, sempre com `Idempotency-Key`.

Essas operações exigem `meetings:write` e permissão de agendamento no cliente. A remoção guarda o registro, autoria e data; restauração usa o estado atual do servidor. Tarefas vinculadas permanecem intactas, com os mesmos vínculos. Uma ação removida não pode ser convertida novamente nem editada por uma atualização genérica. Snapshots antigos não podem apagar tombstones ou reviver registros.

As operações de remoção/restauração não chamam o Google. Um evento ativo exige `keepCalendar:true` explícito para permanecer na agenda; para cancelar convites, concluir `meetings.cancel` e seu journal antes de remover. Uma operação externa pendente bloqueia a remoção. Restaurar o registro não recria o evento nem desfaz um cancelamento.

`GET /meetings?includeRemoved=true` e MCP `meetings_list` com `includeRemoved:true` incluem os registros removidos, identificados por `removed:true`, respeitando os mesmos escopos e permissões. A consulta individual aceita o mesmo parâmetro. Listas comuns continuam mostrando apenas registros ativos. Ações removidas permanecem no histórico com `removedAt` e `removedBy`; consumidores devem ignorá-las nas listas de trabalho ativo.


## Interações e anexos

`interactions.create` recebe `{company, title?, text, at, kind, tags?, fileIds?}`; `kind` é `nota`, `ligacao`, `email` ou `conversa`. `interactions.update` recebe `{company, noteId, patch}`; o patch pode corrigir data, título, texto e tags. A autoria original e a data de criação permanecem; o servidor registra quem alterou cada campo e quando.

MCP: `interactions_create`, `interactions_update`, `interactions_list`. REST: `POST /interactions`, `PATCH /interactions/{id}` com `{company, patch}` e `GET /interactions?company=...&cursor=...&limit=...`. Escritas exigem `engagement:write` e `interacoes.registrar`; leitura exige `engagement:read` e acesso ao cliente. Todos os comandos usam `Idempotency-Key`.

Para anexar, envie previamente o conteúdo pela API de arquivos e forneça os IDs em `fileIds`. Eles devem estar prontos, pertencer ao principal e ao cliente, sem vínculos anteriores incompatíveis. O comando exige também `documents:write` quando há anexos e confirma o espaço de notas, a interação, os documentos e seus vínculos em um batch D1 com guardas dos arquivos. Não aceita nomes, tamanhos ou autoria de documentos informados pelo consumidor como metadados confiáveis.

A interface preserva os IDs dos uploads e a intenção da nota entre tentativas; nenhum documento é cadastrado antes da confirmação do comando. Espaços `kind: notes` e suas notas passam a ser escritos por essas operações. Marcação de leitura, fixação e notas de outros tipos de conversa continuam no fluxo legado autorizado até sua migração.

## Arquivos e documentos

Arquivo é o conteúdo binário imutável no R2; Documento é o registro versionado que pertence a um cliente e pode apontar para Tarefa, Reunião, Conversa ou modelo de entregável. O fluxo oficial é deliberadamente dividido para que uma falha de transporte nunca publique metadados sem bytes:

1. Gere um identificador `up-<UUID>` e envie os bytes com `PUT /api/v1/files/{id}`. Informe `Authorization`, `x-client-company`, `x-file-name` codificado com `encodeURIComponent` e o `Content-Type` real. O limite é 50 MB. Repetir o mesmo ID, cliente, principal e conteúdo é idempotente; mudar qualquer um deles exige outro ID.
2. Confirme o Documento com `POST /api/v1/documents` ou MCP `documents_register`, informando `company`, `fileId`, tipo, visibilidade e vínculos pertinentes. Para nova versão, envie bytes com outro ID e use `/documents/{id}/versions` ou `documents_version` sobre a cabeça atual.
3. Liste metadados com `GET /documents?company=...` ou `documents_list`. Baixe os bytes originais com `GET /files/{id}` ou MCP `files_download`.

Exemplo REST (o `BASE_URL` termina em `/api/v1`):

```bash
FILE_ID="up-$(uuidgen | tr '[:upper:]' '[:lower:]')"
curl --request PUT "$BASE_URL/files/$FILE_ID" \
  --header "Authorization: Bearer $API_TOKEN" \
  --header "x-client-company: cliente-exemplo" \
  --header "x-file-name: relatorio.pdf" \
  --header "Content-Type: application/pdf" \
  --data-binary @relatorio.pdf

curl --request POST "$BASE_URL/documents" \
  --header "Authorization: Bearer $API_TOKEN" \
  --header "Idempotency-Key: register-$FILE_ID" \
  --header "Content-Type: application/json" \
  --data "{\"company\":\"cliente-exemplo\",\"fileId\":\"$FILE_ID\",\"kind\":\"entregavel\",\"visibility\":\"cliente\",\"relatedTaskId\":\"id-da-tarefa\"}"
```

O MCP oferece `files_upload` e `files_download` para conteúdo inline em base64 até 8 MB, além de `files_delete` para limpar uploads órfãos. Acima desse limite, o consumidor usa os endpoints REST binários com o mesmo Bearer concedido ao recurso `/mcp`; não há login de navegador nem cookie adicional. A resposta de `files_download` inclui um recurso binário MCP e metadados estruturados.

Em `files_upload`, envie `{company, fileId, name, mimeType, contentBase64}`. O consumidor gera `fileId` antes da chamada, no formato `up-UUID`, e o reutiliza apenas no retry do mesmo conteúdo; isso torna a chamada idempotente. Em seguida, chame `documents_register` com `{idempotencyKey, input:{company,fileId,...}}`.

`PATCH /documents/{id}` / `documents_update` altera tipo, visibilidade, nota e os vínculos `relatedTaskId`, `relatedMeetingId`, `relatedThreadId` e `deliverableTemplateId`; `null` remove o vínculo. Cada referência é revalidada no mesmo cliente. `POST /documents/{id}/remove` / `documents_remove` é a exclusão normal e reversível, preservando histórico e bytes; `restore` desfaz. `DELETE /files/{id}` / `files_delete` só apaga fisicamente um upload que nunca foi publicado nem citado no histórico.

## Consulta de configurações e alertas

`GET /workspace/settings` / `workspace_settings_get` exige `workspace:read` e a permissão existente de configurações. Retorna `data.workspaceName`, regras efetivas em `data.alertRules`, cargos adicionais em `data.memberRoles`, papéis operacionais adicionais em `data.allocationRoles` e `versions`, sem expor o roster ou a seleção de sessão. `PATCH /workspace/settings` / `workspace_settings_update` substitui qualquer uma dessas listas; IDs de papéis personalizados começam com `custom-` e permanecem estáveis quando o rótulo muda.

`GET /allocations?company=...` / `allocations_list` devolve a equipe do cliente. `POST /allocations` / `allocations_save` cria ou edita uma alocação; `POST /allocations/{id}/remove` / `allocations_remove` a retira. Em `allocation`, `enrollmentId` omitido significa cliente inteiro; informado, precisa pertencer ao mesmo cliente e representa a equipe daquela contratação. Os papéis aceitos são os padrões (`responsavel`, `cs`, `gestor`, `consultor`, `analista`) e os personalizados publicados em `workspace.settings`. Responsável e CX são únicos dentro de cada escopo. Hoje qualquer alocação ativa autoriza o AI Master no cliente inteiro; o recorte por contratação organiza responsabilidade e capacidade, não restringe ações por produto.

`GET /alerts?company=<slug>` / `alerts_list` exige `workspace:read` e cliente autorizado. Retorna alertas ativos que o dono da credencial ainda não marcou como vistos, com `limit` (1–100) e `cursor`/`nextCursor`. Use o ID retornado com `alerts.acknowledge` (ou `alerts.acknowledgeBatch`, até 1000); a ação exige `workspace:write` e permissão de ciência no cliente. A ciência é por pessoa: o alerta sai da fila de quem marcou (o dono da chave ou da concessão OAuth) e continua aberto para o resto da equipe. Um alerta que deixou de existir deve ser consultado novamente.

## Troca de segredo outbound

Pause a assinatura com `PATCH /webhooks/{id}` (`active: false`), chame `POST /webhooks/{id}/rotate-secret` com corpo `{}` e Idempotency-Key e instale `data.secret` no destino antes de retomar (`active: true`). No MCP use `webhooks_update` e `webhooks_rotate_secret`. Exige o proprietário atual, administração e `events:read/write`. A guarda de revisão/lease impede rotação durante envio em andamento.

A assinatura e o recibo guardam apenas o segredo cifrado. Repetir a mesma intenção recupera o mesmo segredo; uma rotação posterior invalida essa recuperação com `rotation_superseded`. Cursor, backlog e histórico permanecem. Após retomar, novas tentativas usam o segredo novo. Não é necessário cadastrar outra assinatura.

## Conversas remotas do cliente

`GET /whatsapp/messages?company=<slug>` e `whatsapp_messages_list` consultam somente o grupo configurado no cliente. Exigem `engagement:read` e recorte autorizado. `before` recebe o `nextCursor` da página anterior; `refresh=true` solicita atualização. Retorno: `data.messages`, `nextCursor`, `fetchedAt`, `stale` e `company`. Sem grupo configurado retorna `whatsapp_group_missing`. A origem externa permanece desligada sem configuração de WhatsApp/Supabase. A consulta não envia mensagens nem importa análises; esses jobs são uma operação distinta.

### Responsáveis por cliente, produto e tarefa

São três atribuições independentes. O cliente pode ficar sem responsável geral, e cada contratação pode ter seu próprio responsável. Trocar qualquer um desses vínculos preserva os responsáveis das tarefas existentes.

Na interface, clique no nome ou em **Sem responsável** na lista/cards de Clientes, ou em **Alterar responsável do cliente** na página do cliente. No plano de uma contratação, use **Alterar responsável do produto**. Escolha uma pessoa ou **Sem responsável** e salve.

- API: `POST /api/v1/clients/{company}/responsible`, com `Idempotency-Key` e corpo `{"memberId":"ID_DO_MEMBRO"}`.
- MCP: `clients_set_responsible`, com `idempotencyKey` e `input: { company, memberId }`.
- Sem `enrollmentId`, altera somente o responsável geral. Com `enrollmentId`, altera somente essa contratação. `memberId: null` remove a atribuição no escopo escolhido.
- Consulte os IDs em `/members` / `members_list` e `/enrollments` / `enrollments_list`. Tarefas continuam usando `tasks.update` / `tasks_update` com `ownerId`.

As três vias executam `clients.setResponsible`, exigem `workspace:write` e a permissão `alocacao.editar`. A alocação geral mantém também `leadId` compatível com leitores antigos; ao remover, limpa esse campo. Outros papéis e responsáveis de outros níveis são preservados. Dedicação existente é mantida; novo vínculo usa 30%. Uma troca passa a valer hoje, sem término programado; repetir uma atribuição já vigente mantém suas datas. A auditoria registra o membro, escopo e responsável anterior. Membros inativos, contratação cancelada/arquivada ou de outro cliente e versões desatualizadas são recusados.

**Filtros:** a lista mostra o responsável geral e oferece **Responsável pelo cliente**, incluindo **Sem responsável**. **Responsável pelo produto** aparece somente após escolher um produto concreto; trocar ou limpar o produto limpa esse filtro, inclusive ao restaurar uma visão salva sem produto. Os dois filtros se combinam: cliente de uma pessoa com o produto sob outra. O segundo filtro considera somente contratações atuais do produto selecionado, sem herdar o responsável geral. Se houver recompra, basta uma contratação atual corresponder ao responsável escolhido (inclusive sem responsável).

API `GET /clients` e MCP `clients_list` oferecem `clientResponsibleId` e `productResponsibleId`; o segundo exige `productId`. Ambos aceitam `__none__`. Os filtros genéricos antigos `memberId`/`role` mantêm a semântica de alocação efetiva para compatibilidade.
