import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const prepareMigrationPath = new URL("../supabase/migrations/006_security_hardening.sql", import.meta.url);
const enforceMigrationPath = new URL("../supabase/migrations/007_enforce_security_hardening.sql", import.meta.url);
const rollbackMigrationPath = new URL("../supabase/rollbacks/006_security_hardening_rollback.sql", import.meta.url);
const dashboardPath = new URL("../src/components/dashboard.tsx", import.meta.url);
const layoutPath = new URL("../src/app/layout.tsx", import.meta.url);

async function readMigration() {
  const [prepare, enforce] = await Promise.all([
    readFile(prepareMigrationPath, "utf8"),
    readFile(enforceMigrationPath, "utf8"),
  ]);
  return `${prepare}\n${enforce}`;
}

test("security rollout remains compatible with the live frontend until enforcement", async () => {
  const [prepare, enforce] = await Promise.all([
    readFile(prepareMigrationPath, "utf8"),
    readFile(enforceMigrationPath, "utf8"),
  ]);

  assert.doesNotMatch(prepare, /revoke\s+all\s+on\s+caixa\.transactions\s+from\s+anon/i);
  assert.doesNotMatch(prepare, /drop\s+policy\s+if\s+exists\s+"public upload caixa files"/i);
  assert.match(prepare, /function\s+caixa\.create_transaction\s*\(/i);
  assert.doesNotMatch(prepare, /Upload de comprovante não autorizado ou expirado/i);
  assert.match(enforce, /revoke\s+all\s+on\s+caixa\.transactions\s+from\s+anon,\s*authenticated/i);
  assert.match(enforce, /drop\s+policy\s+if\s+exists\s+"public upload caixa files"/i);
  assert.match(enforce, /Upload de comprovante não autorizado ou expirado/i);
});

test("the preparation migration has an atomic production rollback", async () => {
  const rollback = await readFile(rollbackMigrationPath, "utf8");

  assert.match(rollback, /(?:^|\n)begin;/i);
  assert.match(rollback, /create\s+or\s+replace\s+function\s+caixa\.authenticate_manager/i);
  assert.match(rollback, /create\s+or\s+replace\s+function\s+caixa\.create_transaction/i);
  assert.match(rollback, /drop\s+view\s+if\s+exists\s+caixa\.transactions_public/i);
  assert.match(rollback, /drop\s+table\s+if\s+exists\s+caixa\.manager_auth_attempts/i);
  assert.match(rollback, /commit;\s*$/i);
});

test("public access uses a filtered view instead of the transactions table", async () => {
  const sql = await readMigration();

  assert.match(sql, /revoke\s+all\s+on\s+caixa\.transactions\s+from\s+anon,\s*authenticated/i);
  assert.match(sql, /create\s+(?:or\s+replace\s+)?view\s+caixa\.transactions_public/i);
  assert.match(sql, /where\s+transactions\.deleted_at\s+is\s+null/i);
  assert.match(sql, /null::text\s+as\s+student_name/i);
  assert.match(sql, /null::text\s+as\s+class_name/i);
  assert.match(sql, /grant\s+select\s+on\s+caixa\.transactions_public\s+to\s+anon,\s*authenticated/i);
  assert.doesNotMatch(sql, /grant\s+select\s+on\s+caixa\.transactions\s+to\s+anon/i);
});

test("the dashboard keeps the manager PIN only in memory and separates public from manager reads", async () => {
  const [sql, dashboard] = await Promise.all([
    readMigration(),
    readFile(dashboardPath, "utf8"),
  ]);

  assert.match(sql, /function\s+caixa\.list_transactions\s*\(/i);
  assert.match(sql, /caixa\.authenticate_manager\s*\(p_manager_id,\s*p_pin\)/i);
  assert.match(dashboard, /from\("transactions_public"\)/);
  assert.match(dashboard, /rpc\("list_transactions"/);
  assert.doesNotMatch(dashboard, /from\("transactions"\)/);
  assert.doesNotMatch(dashboard, /localStorage/);
  assert.doesNotMatch(dashboard, /sessionStorage/);
});

test("receipt storage requires a short-lived manager authorization", async () => {
  const [sql, dashboard] = await Promise.all([
    readMigration(),
    readFile(dashboardPath, "utf8"),
  ]);

  assert.match(sql, /create\s+table\s+caixa\.authorized_receipt_uploads/i);
  assert.match(sql, /function\s+caixa\.authorize_receipt_upload\s*\(/i);
  assert.match(sql, /drop\s+policy\s+if\s+exists\s+"public upload caixa files"/i);
  assert.match(sql, /drop\s+policy\s+if\s+exists\s+"public delete caixa files"/i);
  assert.match(sql, /create\s+policy\s+"upload authorized caixa receipts"/i);
  assert.match(sql, /create\s+policy\s+"delete pending caixa receipts"/i);
  assert.match(sql, /create\s+policy\s+"read active caixa receipts"/i);
  assert.match(sql, /delete\s+from\s+caixa\.authorized_receipt_uploads/i);

  const authorizationCall = dashboard.indexOf('rpc("authorize_receipt_upload"');
  const uploadCall = dashboard.indexOf('.upload(receiptPath, file)');
  assert.notEqual(authorizationCall, -1);
  assert.notEqual(uploadCall, -1);
  assert.ok(authorizationCall < uploadCall, "upload must happen only after manager authorization");
});

test("managers can temporarily read receipts from deleted transactions without write access", async () => {
  const [sql, dashboard] = await Promise.all([
    readMigration(),
    readFile(dashboardPath, "utf8"),
  ]);

  assert.match(sql, /create\s+table\s+caixa\.authorized_receipt_reads/i);
  assert.match(sql, /function\s+caixa\.authorize_receipt_read\s*\(/i);
  assert.match(sql, /now\(\)\s*\+\s*interval\s+'2 minutes'/i);

  const readAuthorizationCall = dashboard.indexOf('rpc("authorize_receipt_read"');
  const signedUrlCall = dashboard.indexOf('.createSignedUrl(path, 60)');
  assert.notEqual(readAuthorizationCall, -1);
  assert.notEqual(signedUrlCall, -1);
  assert.ok(readAuthorizationCall < signedUrlCall, "manager read authorization must precede the signed URL");
});

test("manager authentication throttles repeated PIN failures without storing raw addresses", async () => {
  const sql = await readMigration();

  assert.match(sql, /create\s+table\s+caixa\.manager_auth_attempts/i);
  assert.match(sql, /extensions\.digest\s*\(/i);
  assert.match(sql, /attempted_at\s*>\s*now\(\)\s*-\s*interval\s+'15 minutes'/i);
  assert.match(sql, /failed_attempts\s*>=\s*5/i);
  assert.match(sql, /raise\s+exception\s+'Muitas tentativas/i);
  assert.match(sql, /insert\s+into\s+caixa\.manager_auth_attempts/i);
  assert.doesNotMatch(sql, /client_(?:ip|address)\s+text/i);
});

test("security definer functions do not trust the public search path", async () => {
  const sql = await readMigration();

  assert.doesNotMatch(sql, /set\s+search_path\s*=\s*[^;\n]*\bpublic\b/i);
});

test("production builds do not depend on downloading Google Fonts", async () => {
  const layout = await readFile(layoutPath, "utf8");

  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.doesNotMatch(layout, /Geist(?:_Mono)?\s*\(/);
});
