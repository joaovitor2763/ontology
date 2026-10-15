# documents · documentos do cliente

Arquivos de cada cliente: contrato, entregável, evidência, ata, comunicação ou outro; com versão, vínculos (entrega, reunião, espaço de conversa), visibilidade (interna ou cliente) e revisão de entregáveis com trilha.

## Arquivos

- `domain/models.ts` — `ClientDocument`, `DocKind`, `DocVisibility`, revisão (`reviewPatch`).
- `application/attachments.ts` — `AttachmentRepository` (put, get, remove) e `attachDocument`: o conteúdo é gravado antes do registro; nunca registre metadados de um arquivo que não foi guardado.
- `infrastructure/attachments.ts` — repositório que escreve no IndexedDB local e, no modo remoto, no R2 via `/api/files/[id]` (`remote-attachments.ts`). Integrações usam o contrato equivalente `/api/v1/files/{id}`; MCP usa `files_upload`, `files_download` e `files_delete`. `downloadAttachment` abre pelo blob.
- `infrastructure/state.ts` — documento `ontology.documents.vN` (documentos extras, removidos, versões, revisões). `deliverable-templates.ts` — dez modelos de entregável em Markdown com checklist de validação.
- `presentation/FilesPanel.tsx` — lista, prévia (texto, imagem e PDF), versões, revisão. `StageDocumentModal.tsx` — envio com tipo, vínculos, modelo e nota. `UploadDocumentButton.tsx`.
- A lista geral remota lê títulos de tarefas vinculadas por `POST /api/documents/task-titles` (sessão, uso interno); o painel filtrado fica sob `ClientExecutionProvider` e o modal usa as tarefas efetivas desse cliente. A rota `/documentos` não hidrata `ontology.delivery.v2` no navegador. O modo local mantém `useClientProgress` documental.

## Regras

- `id` de documento enviado começa com `up-`; o mesmo id endereça o conteúdo no R2 (`<workspace>/<id>`).
- Arquivo e Documento são etapas distintas: primeiro os bytes, depois `documents.register` ou `documents.version`. Vínculos com tarefa, reunião, conversa e modelo são validados no cliente e podem ser alterados por `documents.update`; `null` limpa o vínculo.
- Remover é reversível: preserva registro e conteúdo por tombstone; restaurar não reenvia bytes. Arquivos referenciados, inclusive por histórico e registros removidos, não podem ser apagados pelo endpoint de arquivos. Nova versão aponta para a anterior (`supersedesId`).
- Transcrições do Meet e anexos da timeline entram por aqui, com `relatedMeetingId` ou `relatedThreadId`.

- A prévia carrega apenas o documento aberto, aborta ao fechar e mantém no máximo dois blobs por 60 segundos. Textos têm limite de 1 MB e 40 mil caracteres exibidos; imagens/PDF, 5 MB. Conteúdo textual é escapado, nunca interpretado como HTML. Formatos Office seguem disponíveis por download, sem conversão no navegador.
- `useDocumentOperation` aplica `documents.remove` e `documents.restore` na hora, desfazendo na recusa; registrar e versionar dependem do upload e do id do servidor, e continuam esperando a confirmação.
