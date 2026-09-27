import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const phase = process.argv[2];
if (!new Set(["prepare", "enforce"]).has(phase)) {
  throw new Error("Uso: node tests/staging-security.mjs <prepare|enforce>");
}

async function readStagingConfig() {
  try {
    const contents = await readFile(new URL("../.env.staging.local", import.meta.url), "utf8");
    return Object.fromEntries(
      contents
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
        .map((line) => {
          const [name, ...valueParts] = line.split("=");
          const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
          return [name.trim(), value];
        }),
    );
  } catch {
    return {};
  }
}

const stagingConfig = await readStagingConfig();
const stagingUrl = process.env.STAGING_SUPABASE_URL ?? stagingConfig.STAGING_SUPABASE_URL;
const stagingKey = process.env.STAGING_SUPABASE_ANON_KEY ?? stagingConfig.STAGING_SUPABASE_ANON_KEY;
const confirmation = process.env.STAGING_CONFIRMATION ?? stagingConfig.STAGING_CONFIRMATION;

assert.ok(stagingUrl, "Defina STAGING_SUPABASE_URL.");
assert.ok(stagingKey, "Defina STAGING_SUPABASE_ANON_KEY.");
assert.equal(
  confirmation,
  "caixa-security-staging",
  "Defina STAGING_CONFIRMATION=caixa-security-staging para confirmar o ambiente temporário.",
);

async function readProductionUrl() {
  try {
    const contents = await readFile(new URL("../.env.local", import.meta.url), "utf8");
    const line = contents.split(/\r?\n/).find((item) => item.startsWith("NEXT_PUBLIC_SUPABASE_URL="));
    return line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const productionUrl = await readProductionUrl();
assert.notEqual(
  stagingUrl.replace(/\/$/, ""),
  productionUrl?.replace(/\/$/, ""),
  "A URL informada é a de produção. Teste interrompido antes de qualquer escrita.",
);

const supabase = createClient(stagingUrl, stagingKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const publicResult = await supabase
  .schema("caixa")
  .from("transactions_public")
  .select("id,student_name,class_name,deleted_at")
  .limit(100);

assert.ifError(publicResult.error);
for (const item of publicResult.data ?? []) {
  assert.equal(item.student_name, null, "A visão pública revelou o nome de um aluno.");
  assert.equal(item.class_name, null, "A visão pública revelou uma turma.");
  assert.equal(item.deleted_at, null, "A visão pública revelou uma transação excluída.");
}

const rawResult = await supabase.schema("caixa").from("transactions").select("id").limit(0);
if (phase === "prepare") {
  assert.ifError(rawResult.error);
} else {
  assert.ok(rawResult.error, "A tabela bruta ainda aceita leitura anônima após a migration 007.");
}

const objectPath = `security-check/${crypto.randomUUID()}.png`;
const onePixelPng = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
]);
const uploadResult = await supabase.storage
  .from("caixa-files")
  .upload(objectPath, onePixelPng, { contentType: "image/png", upsert: false });

if (phase === "prepare") {
  assert.ifError(uploadResult.error);
  const cleanupResult = await supabase.storage.from("caixa-files").remove([objectPath]);
  assert.ifError(cleanupResult.error);
} else {
  assert.ok(uploadResult.error, "O bucket ainda aceita upload anônimo após a migration 007.");
}

console.log(`Validação ${phase} concluída no ambiente temporário.`);
