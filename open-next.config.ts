import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/** Sem cache incremental: as páginas são renderizadas no cliente e os dados vêm do D1. */
export default defineCloudflareConfig({});
