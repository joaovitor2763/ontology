# Ontology

Plataforma self-hosted para empresas que entregam **consultoria, serviços e inteligência**. Gerencie clientes, produtos, planos, marcos, ciclos, tarefas, reuniões, documentos e a ontologia do negócio em um só lugar.

## Sua própria instalação na Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/joaovitor2763/ontology/tree/main)

1. Publique pelo botão: Worker, D1 e R2 na sua conta.
2. Configure **Cloudflare Access** para login e indique o primeiro administrador.
3. No app, abra **Configurações → Integrações** para cadastrar Composio e Z-API.

O deploy começa com acesso aos dados fechado. Login, política de acesso e autorização das contas externas exigem configuração do operador — o botão não concede essas permissões por você. Consulte o [guia curto de instalação](DEPLOY.md).

## Recursos

- Catálogo de produtos e planos versionados, contratações e execução por cliente.
- Marcos, ciclos, tarefas, prazos, aceites, alocações e alertas.
- Reuniões, interações, documentos e ontologia editável por cliente.
- Papéis de acesso, aprovação de membros e trilha de auditoria.
- E-mail e agenda Google/Microsoft via **Composio**, com autorização pessoal e consultas de leitura.
- Captura de mensagens WhatsApp via **Z-API** no D1 próprio; **Supabase** permanece como fonte alternativa.
- API REST, MCP e OAuth para clientes compatíveis, sem conexão proprietária obrigatória.
- Integrações opcionais de IA e Google Agenda/Meet direto.

Credenciais dos conectores são cifradas no servidor; nunca entram no repositório. As integrações exigem contas próprias e podem ter custos. Os exemplos incluídos são demonstrativos/sintéticos; não representam operações reais. A captura WhatsApp começa na ativação e não arquiva mídias neste primeiro corte.

## Desenvolvimento

Node.js 24 e npm:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

```sh
npm run check   # lint, TypeScript, testes e auditoria visual
npm run build   # Next.js
npm run deploy  # OpenNext, D1/migrations e Worker na sua conta
```

`AUTH_MODE=dev` serve somente ao desenvolvimento local. Nunca o utilize em produção. Para produção, siga [DEPLOY.md](DEPLOY.md) e o [guia de Cloudflare Access](docs/login-cloudflare.md).

## Licença

[MIT](LICENSE): uso comercial, adaptação e self-hosting permitidos nos termos da licença, sem garantia. Bibliotecas e fontes mantêm suas próprias licenças.
