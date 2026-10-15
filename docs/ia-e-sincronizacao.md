# IA, mensagens e revisão humana

O modelo padrão é GPT 5.6 Luna pela Responses API da OpenAI, através do gateway Cloudflare `g4-managed` e da chave BYOK existente `os-key-openai`. O token do aplicativo tem somente AI Gateway:Run. Prompts e respostas não são retidos no log do gateway (`cf-aig-collect-log=false`), e Responses usa `store=false`. O D1 mantém o resultado, suas fontes e metadados de uso; transcrições e anexos continuam no R2.

As análises existentes (assistente, classificação, relatório, extração de reunião) usam a mesma porta. O fluxo persistente de WhatsApp e reunião exige JSON validado e guarda resumos, decisões mencionadas, sugestões de ações, riscos e pendências. Mensagens e transcrições são dados não confiáveis e nunca instruções de execução.

Uma análise é um registro próprio. `pending` não altera reuniões, entregas ou compromissos; `accepted` significa que um humano validou o registro; `dismissed` preserva a decisão de descartar. O mesmo conteúdo não volta à fila quando uma rotina é repetida. Conteúdo de origem alterado gera outra versão, sem reabrir a revisão anterior. A aprovação não dispara mensagens, agenda nem entregas. O time registra essas ações nos fluxos existentes.

A coleta abre diariamente às 06h de São Paulo. Um cron de cinco minutos continua trabalhos pendentes; a solicitação manual também tenta um primeiro lote. O primeiro histórico é de 30 dias; a rotina incremental relê dois dias para pegar entradas atrasadas. Mensagens com mais de dois dias de atraso podem ser recuperadas por uma importação de histórico. Grupos removidos ou alterados cancelam importações antigas. Nada escreve no Supabase nem no WhatsApp.

Cada lote tem no máximo 100 mensagens e usa cursor composto por data de origem e ID. O cursor conserva a precisão original da data. D1 deduplica por workspace, cliente, grupo e ID. Um grupo admite uma importação ativa; a lease impede que cron e botão processem o mesmo lote ao mesmo tempo. Falhas têm até três tentativas, e uma nova importação pode ser solicitada após a interrupção. Resumos usam partes de até 100 mensagens do mesmo dia, limitadas por tamanho, com referência a cada ID. Dias muito movimentados têm várias partes visíveis, sem truncamento silencioso.

## D1 e R2

Não colocamos mensagens e resultados de IA dentro dos documentos JSON versionados: isso multiplicaria o tamanho de cada leitura e conflito da interface. As tabelas normalizadas têm índices compostos para cliente/grupo/data, fila e paginação de sugestões. Os documentos existentes conservam suas chaves e protocolo de concorrência. O teste consulta EXPLAIN QUERY PLAN para confirmar que a leitura por período usa o índice de mensagens.

Listagens de análises usam D1 Sessions com bookmark, garantindo que uma página não retroceda em relação à anterior. Depois de uma revisão, a interface volta ao primário para ler a própria gravação. Login, permissões, sessões, leases e gravações sempre usam o primário. Isso permite habilitar réplicas sem atrasar revogações de acesso. Não alteramos a localização do banco existente.

R2 já oferece consistência forte para objetos e redundância gerenciada. Criar cópias manuais não acelera as consultas relacionais e introduziria outro processo de sincronização. Arquivos permanecem privados, entregues pelo servidor autenticado. As tabelas de metadados já têm índice por workspace; conteúdo grande não entra no D1.

Referências: [D1 Sessions e read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/), [consistência R2](https://developers.cloudflare.com/r2/reference/consistency/), [aliases BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/).
