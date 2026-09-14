# Caixa Pessoal — Web

Aplicação normal em Next.js com Supabase para autenticação, banco e comprovantes privados.

Este aplicativo usa um espaço isolado dentro do Supabase compartilhado: schema `caixa`, tabela `caixa.transactions`, membros em `caixa.members` e bucket privado `caixa-files`.

## Configuração

1. Crie um projeto em <https://supabase.com/dashboard>.
2. Abra **SQL Editor** e execute `supabase/migrations/001_initial.sql`.
3. Em **Project Settings → API → Exposed schemas**, adicione `caixa`.
4. Em **Project Settings → API**, copie a URL e a chave pública `anon`.
5. Copie `.env.example` para `.env.local` e preencha as duas variáveis.
6. Execute `npm run dev` e abra a página inicial. Não há login.

## Acesso

O aplicativo não possui login. Quem tiver o endereço consegue consultar e alterar o caixa. O schema e o bucket continuam separados dos outros miniaplicativos, mas não existe proteção individual dentro deste app.

Se a migration antiga com login já foi executada, aplique `supabase/migrations/002_remove_login.sql`. Em uma instalação nova, execute apenas `001_initial.sql`.

## Verificação

```powershell
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
