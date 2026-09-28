# Portal da Transparência Escolar — Web

Aplicação em Next.js com Supabase para registrar e consultar depósitos, despesas e comprovantes escolares.

Este aplicativo usa um espaço isolado dentro do Supabase compartilhado: schema `caixa`, tabela `caixa.transactions`, membros em `caixa.members` e bucket privado `caixa-files`.

## Configuração

1. Crie um projeto em <https://supabase.com/dashboard>.
2. Abra **SQL Editor** e execute `supabase/migrations/001_initial.sql`.
3. Em **Project Settings → API → Exposed schemas**, adicione `caixa`.
4. Em **Project Settings → API**, copie a URL e a chave pública `anon`.
5. Copie `.env.example` para `.env.local` e preencha as duas variáveis.
6. Execute `npm run dev` e abra a página inicial. Não há login.

## Acesso

Pais e visitantes acessam o endereço sem login e podem consultar as transações ativas. A criação, exclusão e restauração ficam na **Área da gestão**, protegida por usuário e PIN individual. O banco registra o responsável, a ação e a data de cada alteração.

Se a migration antiga com login já foi executada, aplique `supabase/migrations/002_remove_login.sql`. Em uma instalação nova, não execute a `002`.

Em uma instalação nova, aplique `001_initial.sql`, `003_transparency_fields.sql`, `005_audit_history.sql`, `006_security_hardening.sql`, `007_enforce_security_hardening.sql` e `008_privacy_and_audit_fixes.sql`, nessa ordem. A `003` gera e exibe os cinco PINs uma única vez; salve o resultado antes de fechar a tela. A `004` é usada somente quando for necessário redefinir todos os PINs. A `008` protege comprovantes de depósito (LGPD), fecha search paths residuais e habilita edição de transações pelo gestor.

## Endurecimento de segurança em produção

As migrations `006` e `007` formam um rollout em duas etapas. Não execute as duas de uma vez no projeto que já está no ar.

1. Faça um backup do banco.
2. Execute apenas `supabase/migrations/006_security_hardening.sql`. Ela cria a visão pública, limita tentativas de PIN e prepara as autorizações de comprovantes sem remover os acessos usados pelo frontend antigo.
3. Publique o frontend desta mesma versão e aguarde o workflow do GitHub Pages concluir.
4. Valide a consulta pública, o login da gestão, a criação sem e com comprovante, a leitura de comprovantes e a lixeira.
5. Execute `supabase/migrations/007_enforce_security_hardening.sql`. Ela revoga a leitura da tabela bruta e remove as políticas anônimas antigas do bucket.
6. Repita a validação e confirme que o domínio está forçando HTTPS no GitHub Pages.

Até a etapa 5, o acesso antigo continua aberto para permitir rollback do frontend sem indisponibilidade. Depois da `007`, não reverta o frontend para uma versão anterior.

## Verificação

```powershell
node --test tests/security-hardening.test.mjs
npm.cmd run lint
npm.cmd run build
```

## Publicação no GitHub Pages

O projeto usa exportação estática do Next.js. O workflow `.github/workflows/deploy-pages.yml` gera `out/` e publica automaticamente quando há push na branch `main`.

No repositório GitHub:

1. Em **Settings → Secrets and variables → Actions**, crie os secrets `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Em **Settings → Pages → Build and deployment**, selecione **GitHub Actions**.
3. Faça push para `main`.

O caminho-base é calculado automaticamente pelo nome do repositório durante o build.
