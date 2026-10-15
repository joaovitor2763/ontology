# Guia para agentes

## Antes de alterar código

Este projeto usa uma versão do Next.js com mudanças incompatíveis. Leia o guia relevante em `node_modules/next/dist/docs/` antes de editar código Next.js e observe avisos de depreciação.

Consulte os `AGENTS.md` da área alterada e os testes de arquitetura. Não altere arquivos fora do escopo solicitado. Preserve mudanças preexistentes e não inclua segredos, dados de usuários/clientes ou arquivos de ambiente em commits.

## Comandos

```bash
npm run dev
npm run check
npm run build
npm run preview
```

Rode `npm run check` antes de considerar uma tarefa concluída. Para implantação, siga o guia do repositório e os workflows configurados; não presuma que testes locais equivalem a validação remota.

## Organização

- `src/app/`: rotas e composição de páginas.
- `src/modules/<contexto>/`: domínio, aplicação, infraestrutura e apresentação.
- `src/server/`: autenticação, autorização, persistência e integrações de servidor.
- `src/shared/`: utilitários e componentes compartilhados.
- `migrations/`: alterações do esquema de dados.
- `tests/`: testes automatizados.
- `docs/`: documentação técnica e decisões duráveis.

Leia [o mapa da arquitetura](docs/mapa-arquitetura-atual.md) e [a arquitetura DDD](docs/arquitetura-ddd.md) antes de alterar fronteiras entre módulos ou persistência.

## Convenções

- Mantenha domínio e aplicação independentes de React, Next.js, apresentação e infraestrutura. Respeite as regras automatizadas de dependência entre camadas.
- Regras de autorização devem permanecer centralizadas no domínio/servidor apropriado e cobertas pela matriz de permissões e testes.
- Mudanças no formato persistido exigem compatibilidade explícita, migração quando necessária e testes.
- Datas sem horário devem usar os utilitários compartilhados para evitar deslocamentos de fuso.
- Segredos ficam somente em armazenamento seguro de ambiente e não devem ser registrados em arquivos versionados. Use placeholders claramente fictícios nos exemplos.
- Integrações opcionais dependem de configuração externa; documente pré-requisitos sem incluir identificadores privados ou valores de ambiente.
- Mantenha exemplos e fixtures sintéticos, sem nomes, contatos ou documentos de terceiros.

## Documentação

Atualize a documentação quando uma mudança alterar contratos, persistência, autorização, integrações ou fluxos compostos. Corrija links e diferencie comportamento implementado de proposta. Não publique registros de operação, dados reais, medições privadas ou detalhes de ambientes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
