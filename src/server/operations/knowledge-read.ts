import { z } from 'zod';
import type { ServerEnv } from '../context';
import type { OperationPrincipal } from './principal.ts';
import type { GraphNode, GraphEdge, Ontology } from '../../modules/knowledge/domain/models.ts';
import { typeOf } from '../../modules/knowledge/domain/ontology.ts';
import { readKnowledge } from './knowledge.ts';
import { knowledgeReadOptions, knowledgeListOptions } from './knowledge-schemas.ts';
import { OperationError } from './errors.ts';
import { requestHash } from './transaction.ts';

export function knowledgeCounts(ontology: Ontology) {
  return { elements: ontology.nodes.length, connections: ontology.edges.length, domains: ontology.domains.length };
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new OperationError(422, 'invalid_input', 'Parâmetros de ontologia inválidos.', {
    fields: result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
  });
  return result.data;
}
function nodeSummary(node: GraphNode) {
  return { id: node.id, label: node.label, kind: node.kind, domain: node.domain,
    elementType: typeOf(node), ownerId: node.ownerId, coverage: node.coverage,
    coverageAssessed: node.coverageAssessed };
}
function edgeSummary(edge: GraphEdge) {
  return { id: edge.id, from: edge.from, to: edge.to, label: edge.label, cardinality: edge.cardinality };
}

/** REST keeps its legacy full read; MCP explicitly requests summary. Lists never include the draft. */
export async function readKnowledgeResource(
  env: ServerEnv, principal: OperationPrincipal, company: string,
  resource: string | undefined, record: string | undefined, query: Record<string, unknown>,
) {
  if (!resource) {
    const options = parse(knowledgeReadOptions, query);
    if (options.view === 'summary' && options.includeDraft)
      throw new OperationError(422, 'invalid_input', 'includeDraft exige view=full.');
    const result = await readKnowledge(env, principal, { company });
    if (options.view !== 'summary') {
      if (options.includeDraft === false) return { data: { ontology: result.data.ontology, version: result.data.version } };
      return result;
    }
    const { ontology, version } = result.data;
    return { data: { company, version, counts: knowledgeCounts(ontology),
      domains: ontology.domains.slice(0, 25), domainsTruncated: ontology.domains.length > 25,
      related: { elements: `/api/v1/knowledge/${company}/elements`, connections: `/api/v1/knowledge/${company}/connections`, domains: `/api/v1/knowledge/${company}/domains` } } };
  }
  const schema = record ? z.object({ expectedVersion: z.number().int().min(0).optional() }).strict()
    : resource === 'elements' ? knowledgeListOptions.omit({ nodeId: true })
    : resource === 'connections' ? knowledgeListOptions.omit({ domain: true, elementType: true })
    : knowledgeListOptions.omit({ domain: true, elementType: true, nodeId: true, view: true });
  const options = parse(schema, query) as z.infer<typeof knowledgeListOptions>;
  const { ontology, version } = (await readKnowledge(env, principal, { company })).data;
  if (options.expectedVersion !== undefined && options.expectedVersion !== version)
    throw new OperationError(409, 'snapshot_changed', 'O mapa mudou. Recomece pela primeira página.', { snapshotVersion: version });
  if (record) {
    const rows = resource === 'elements' ? ontology.nodes : resource === 'connections' ? ontology.edges : ontology.domains;
    const matches = rows.filter(row => row.id === record);
    if (matches.length !== 1) throw new OperationError(404, 'not_found', 'Registro não encontrado ou ambíguo neste mapa.');
    return { data: matches[0], snapshotVersion: version };
  }
  const term = options.q?.trim().toLocaleLowerCase('pt-BR') ?? '';
  const matches = (row: { id: string; label: string }) => !term || `${row.id} ${row.label}`.toLocaleLowerCase('pt-BR').includes(term);
  const nodes = ontology.nodes.filter(node => matches(node) && (!options.domain || node.domain === options.domain) && (!options.elementType || typeOf(node) === options.elementType));
  const edges = ontology.edges.filter(edge => matches(edge) && (!options.nodeId || edge.from === options.nodeId || edge.to === options.nodeId));
  const domains = ontology.domains.filter(matches);
  const rows = resource === 'elements' ? nodes : resource === 'connections' ? edges : domains;
  const limit = options.limit ?? 25;
  const binding = await requestHash('knowledge.list', { company, resource, q: term, domain: options.domain ?? '', elementType: options.elementType ?? '', nodeId: options.nodeId ?? '', view: options.view ?? 'summary' });
  let offset = 0;
  if (options.cursor) {
    let cursor: { offset: number; version: number; binding: string };
    try { cursor = JSON.parse(atob(options.cursor)); }
    catch { throw new OperationError(422, 'invalid_cursor', 'Cursor de ontologia inválido.'); }
    if (!cursor || cursor.binding !== binding || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || !Number.isSafeInteger(cursor.version) || cursor.version < 0)
      throw new OperationError(422, 'invalid_cursor', 'Mantenha cliente, filtros e view ao continuar a página.');
    if (cursor.version !== version)
      throw new OperationError(409, 'snapshot_changed', 'O mapa mudou. Recomece pela primeira página.', { snapshotVersion: version });
    offset = cursor.offset;
  }
  const page = rows.slice(offset, offset + limit);
  const data = options.view === 'full' || resource === 'domains' ? page
    : resource === 'elements' ? (page as GraphNode[]).map(nodeSummary) : (page as GraphEdge[]).map(edgeSummary);
  return { data, total: rows.length, snapshotVersion: version,
    nextCursor: offset + limit < rows.length ? btoa(JSON.stringify({ offset: offset + limit, version, binding })) : null };
}
