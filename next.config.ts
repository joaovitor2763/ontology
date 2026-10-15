import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

// Bindings locais (D1, R2) disponíveis em `next dev`; sem wrangler.jsonc o app segue no modo navegador.
initOpenNextCloudflareForDev();

/** Legacy addresses keep working; every new link comes from src/shared/lib/routes.ts. */
const legacy: { source: string; destination: string }[] = [
  { source: "/empresas", destination: "/clientes" },
  { source: "/empresas/:slug", destination: "/clientes/:slug" },
  { source: "/empresas/:slug/jornada", destination: "/clientes/:slug/plano" },
  {
    source: "/empresas/:slug/ciclos",
    destination: "/clientes/:slug/plano?visao=ciclos",
  },
  {
    source: "/empresas/:slug/cronograma",
    destination: "/clientes/:slug/plano?visao=cronograma",
  },
  { source: "/empresas/:slug/entregas", destination: "/clientes/:slug/entregas" },
  {
    source: "/empresas/:slug/solicitacoes",
    destination: "/clientes/:slug/solicitacoes",
  },
  { source: "/empresas/:slug/arquivos", destination: "/clientes/:slug/documentos" },
  { source: "/empresas/:slug/atividade", destination: "/clientes/:slug/agenda" },
  {
    source: "/empresas/:slug/relacionamento",
    destination: "/clientes/:slug/conversas",
  },
  { source: "/empresas/:slug/inteligencia", destination: "/clientes/:slug" },
  { source: "/empresas/:slug/alertas", destination: "/alertas?cliente=:slug" },
  { source: "/empresas/:slug/:section", destination: "/clientes/:slug/:section" },
  { source: "/pipeline", destination: "/execucao" },
  { source: "/ciclos", destination: "/execucao?visao=ciclos" },
  { source: "/cronograma", destination: "/execucao?visao=cronograma" },
  { source: "/eventos", destination: "/agenda" },
  { source: "/relacionamento", destination: "/conversas" },
  { source: "/produtos", destination: "/catalogo/produtos" },
  { source: "/jornada", destination: "/catalogo/planos" },
  { source: "/catalogo", destination: "/catalogo/produtos" },
  { source: "/pessoas", destination: "/equipe/membros" },
  { source: "/carteira", destination: "/equipe/alocacao" },
  { source: "/equipe", destination: "/equipe/membros" },
  { source: "/admin", destination: "/configuracoes" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  // O repositório é a raiz; ignora lockfiles soltos em pastas acima.
  turbopack: { root: __dirname, resolveAlias: { "cloudflare:workers": "./src/server/operations/oauth-worker-entrypoint.ts" } },
  webpack(config) {
    config.resolve.alias["cloudflare:workers"] = `${__dirname}/src/server/operations/oauth-worker-entrypoint.ts`;
    return config;
  },
  async redirects() {
    return legacy.map((rule) => ({ ...rule, permanent: false }));
  },
};

export default nextConfig;
