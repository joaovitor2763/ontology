import { z } from 'zod';

const id = z.string().min(1).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
export const knowledgeElementType = z.enum(['company', 'area', 'person', 'object', 'process', 'system', 'rule', 'metric', 'action']);
const point = z.object({ x: z.number(), y: z.number() }).strict();
const text = z.string().max(8000);
export const knowledgeNode = z.object({
  id: id.describe('ID estável e único no workspace. Use prefixo do cliente; reutilize ao editar.'),
  label: z.string().trim().min(1).max(500).describe('Nome do elemento.'),
  kind: z.enum(['class', 'instance']).describe('class: conceito/modelo; instance: elemento concreto do cliente.'),
  domain: id.describe('ID de domínio retornado por knowledge_domains_list. Clientes novos têm organizacao.'),
  elementType: knowledgeElementType.optional(),
  properties: z.array(z.string().max(1000)).max(500).describe('Lista de propriedades textuais; use [] quando não houver.'),
  description: z.string().max(20000).optional(),
  x: z.number().min(-1000000).max(1000000).optional(),
  y: z.number().min(-1000000).max(1000000).optional(),
  coverage: z.number().min(0).max(100).optional().describe('Percentual 0–100; não invente cobertura sem evidência.'),
  coverageAssessed: z.boolean().optional(),
  ownerId: text.optional().describe('ID de uma pessoa do mesmo mapa; vazio limpa o responsável.'),
  state: text.optional(), source: text.optional(), identity: text.optional(),
  policy: text.optional(), permission: text.optional(),
  position: point.optional(), networkPosition: point.optional(),
}).strict().describe('Registro completo: salvar substitui os campos do elemento. Consulte knowledge_element_get antes de editar para preservar os demais campos.');

export const knowledgeEdge = z.object({
  id: id.describe('ID estável da relação; use prefixo do cliente.'),
  from: id.describe('ID do elemento de origem, existente no mesmo mapa ou no lote.'),
  to: id.describe('ID do elemento de destino, diferente da origem.'),
  label: z.string().trim().min(1).max(500).describe('Nome da relação na direção from → to, por exemplo: executa.'),
  description: text.optional(),
  cardinality: z.enum(['one-one', 'one-many', 'many-many']).optional(),
}).strict();

export const knowledgeDomain = z.object({
  id,
  label: z.string().trim().min(1).max(500),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('Cor hexadecimal, por exemplo #64748b.'),
}).strict();

export const knowledgeWriteOptions = {
  responseMode: z.enum(['compact', 'full']).optional().describe('MCP usa compact por padrão: confirmação, versões, contagens e IDs afetados. full inclui grafo e draft inteiros.'),
  expectedVersion: z.number().int().min(0).optional().describe('Versão obtida na leitura. Se mudou, releia antes de enviar uma nova intenção. Retry após timeout mantém chave, versão e corpo.'),
};
export const knowledgeReadOptions = z.object({
  view: z.enum(['summary', 'full']).optional().describe('MCP usa summary por padrão, sem grafo nem draft. Use listas paginadas e consultas por ID para os detalhes.'),
  includeDraft: z.boolean().optional().describe('Somente view=full. O draft pode duplicar conteúdo do grafo; omita para economizar contexto.'),
}).strict();
export const knowledgeListOptions = z.object({
  limit: z.number().int().min(1).max(100).optional().describe('Padrão 25. Reduza para ler registros longos em blocos menores.'),
  cursor: z.string().max(2000).optional(),
  expectedVersion: z.number().int().min(0).optional().describe('snapshotVersion da primeira página. O cursor também protege a versão; snapshot_changed exige reiniciar.'),
  q: z.string().max(500).optional().describe('Busca por ID ou nome.'),
  domain: id.optional(),
  elementType: knowledgeElementType.optional(),
  nodeId: id.optional().describe('Nas conexões, filtra relações de entrada e saída deste elemento.'),
  view: z.enum(['summary', 'full']).optional().describe('Padrão summary. full inclui o conteúdo completo dos registros da página.'),
}).strict();
