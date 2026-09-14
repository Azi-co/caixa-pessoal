import { Dashboard } from "@/components/dashboard";

export default function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <main className="setup-page">
        <section className="setup-card">
          <span className="logo-mark">$</span>
          <h1>Caixa Pessoal</h1>
          <p>A interface está pronta. Falta conectar o projeto Supabase no arquivo <code>.env.local</code>.</p>
        </section>
      </main>
    );
  }
  return <Dashboard initialTransactions={[]} />;
}
