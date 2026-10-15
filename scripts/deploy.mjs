#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Parse JSONC without introducing a runtime dependency or changing strings. */
export function parseConfig(text) {
  let clean = '', quoted = false, escape = false, line = false, block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (line) { if (c === '\n') { line = false; clean += c; } else clean += ' '; continue; }
    if (block) { if (c === '*' && next === '/') { block = false; clean += '  '; i++; } else clean += c === '\n' ? '\n' : ' '; continue; }
    if (quoted) { clean += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '/' && next === '/') { line = true; clean += '  '; i++; continue; }
    else if (c === '/' && next === '*') { block = true; clean += '  '; i++; continue; }
    clean += c;
  }
  let result = ''; quoted = false; escape = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) { result += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    if (c === ',' && /^[\s]*[}\]]/.test(clean.slice(i + 1))) continue;
    result += c;
  }
  return JSON.parse(result);
}
export function databaseName(config) {
  const db = config.d1_databases?.find(item => item.binding === 'DB');
  if (!db) throw new Error('Binding D1 DB ausente no wrangler.jsonc.');
  const name = db.database_name || `${config.name}-db`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(name)) throw new Error('Nome de banco D1 inválido.');
  return name;
}
function command(args, capture = false) {
  const result = spawnSync('npx', args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) throw new Error(`Falha em npx ${args.join(' ')}. Verifique a conta e as permissões Cloudflare.`);
  return result.stdout;
}
export function deploy(run = command) {
  const path = resolve('wrangler.jsonc');
  const config = parseConfig(readFileSync(path, 'utf8'));
  const db = config.d1_databases?.find(item => item.binding === 'DB');
  if (!db) throw new Error('Binding D1 DB ausente.');
  if (!db.database_id) {
    const name = databaseName(config);
    const databases = JSON.parse(run(['wrangler', 'd1', 'list', '--json'], true));
    if (!Array.isArray(databases)) throw new Error('Listagem D1 inválida.');
    const existing = databases.find(item => item.name === name);
    if (existing) {
      if (typeof existing.uuid !== 'string' || !/^[0-9a-f-]{36}$/i.test(existing.uuid)) throw new Error('ID D1 inválido.');
      db.database_name = name; db.database_id = existing.uuid;
      writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
    } else {
      run(['wrangler', 'd1', 'create', name, '--binding', 'DB', '--update-config']);
      const created = parseConfig(readFileSync(path, 'utf8')).d1_databases?.find(item => item.binding === 'DB');
      if (!created?.database_id) throw new Error('Wrangler não gravou o ID D1. Configure o binding e tente novamente.');
    }
  }
  // Provision D1 before migration; migrate before publishing application code.
  run(['wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote']);
  run(['opennextjs-cloudflare', 'deploy']);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes('--help')) console.log('Uso: npm run deploy\n\nBuild OpenNext, provisionamento/reuso do D1 do Worker, migrations e deploy.\nUsa sua conta Wrangler; modifica wrangler.jsonc com os IDs provisionados.\nR2 é provisionado pelo Wrangler ao publicar. Nunca usa recursos do mantenedor.');
  else if (process.argv.length > 2) { console.error('Argumento desconhecido. Use --help.'); process.exitCode = 2; }
  else try { deploy(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
