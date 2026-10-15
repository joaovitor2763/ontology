#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Uso: npm run setup:integration-secret\n\nGera uma chave aleatória e a envia como secret INTEGRATION_SECRET_KEY\npara o Worker Cloudflare selecionado no Wrangler. Não imprime nem grava a chave.\nRequer login Wrangler e confirmação do projeto/ambiente antes de executar.`);
  process.exit(0);
}

if (process.argv.length > 2) {
  console.error("Argumento desconhecido. Use --help.");
  process.exit(2);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Execute em um terminal interativo para confirmar o destino do secret.");
  process.exit(2);
}

const answer = await new Promise((resolve) => {
  process.stdout.write("Confirme que o Wrangler está autenticado na conta e no projeto Cloudflare corretos. Continuar? [s/N] ");
  process.stdin.setEncoding("utf8");
  process.stdin.once("data", (value) => { process.stdin.pause(); resolve(value.trim().toLowerCase()); });
});
if (answer !== "s" && answer !== "sim") {
  console.log("Cancelado; nenhum secret foi enviado.");
  process.exit(0);
}

const secret = randomBytes(32).toString("hex");
const child = spawn("npx", ["wrangler", "secret", "put", "INTEGRATION_SECRET_KEY"], {
  stdio: ["pipe", "inherit", "inherit"],
  shell: process.platform === "win32",
  env: process.env,
});
child.stdin.end(`${secret}\n`);
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
if (code !== 0) {
  console.error("Wrangler não confirmou a gravação do secret. Verifique o destino e tente novamente.");
  process.exit(typeof code === "number" ? code : 1);
}
console.log("INTEGRATION_SECRET_KEY enviado ao Wrangler. A chave não foi exibida nem salva em arquivo.");
