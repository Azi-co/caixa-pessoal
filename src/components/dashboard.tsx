"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestore, Paperclip, Plus, Trash2, Wallet, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Transaction = {
  id: string;
  type: "deposit" | "expense";
  name: string;
  occurred_on: string;
  amount_cents: number;
  receipt_path: string | null;
  receipt_name: string | null;
  deleted_at: string | null;
  created_at: string;
};

export function Dashboard({ initialTransactions }: { initialTransactions: Transaction[] }) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [showDeleted, setShowDeleted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const active = transactions.filter((item) => !item.deleted_at);
  const deleted = transactions.filter((item) => item.deleted_at);
  const visible = showDeleted ? deleted : active;
  const deposits = active.filter((item) => item.type === "deposit").reduce((sum, item) => sum + item.amount_cents, 0);
  const expenses = active.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount_cents, 0);
  const formatMoney = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

  async function refresh() {
    const { data, error } = await supabase.schema("caixa").from("transactions").select("*").order("occurred_on", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error;
    setTransactions(data ?? []);
  }

  useEffect(() => {
    void supabase.schema("caixa").from("transactions").select("*").order("occurred_on", { ascending: false }).order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        else setTransactions(data ?? []);
      });
  }, [supabase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const form = new FormData(event.currentTarget);
      const amount = Number(String(form.get("amount")).replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor válido.");
      const id = crypto.randomUUID();
      const file = form.get("receipt") as File;
      let receiptPath: string | null = null;
      if (file?.size) {
        if (file.size > 10 * 1024 * 1024) throw new Error("O comprovante deve ter no máximo 10 MB.");
        receiptPath = `${id}/${file.name}`;
        const { error } = await supabase.storage.from("caixa-files").upload(receiptPath, file);
        if (error) throw error;
      }
      const { error } = await supabase.schema("caixa").from("transactions").insert({
        id, type: form.get("type"), name: String(form.get("name")).trim(),
        occurred_on: form.get("date"), amount_cents: Math.round(amount * 100),
        receipt_path: receiptPath, receipt_name: file?.size ? file.name : null,
      });
      if (error) {
        if (receiptPath) await supabase.storage.from("caixa-files").remove([receiptPath]);
        throw error;
      }
      await refresh(); formRef.current?.reset(); setDialogOpen(false); setMessage("Transação salva.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }

  async function toggleDeleted(item: Transaction) {
    setBusy(true); setMessage("");
    const { error } = await supabase.schema("caixa").from("transactions").update({ deleted_at: item.deleted_at ? null : new Date().toISOString() }).eq("id", item.id);
    if (error) setMessage(error.message); else await refresh();
    setBusy(false);
  }

  async function openReceipt(path: string) {
    const { data, error } = await supabase.storage.from("caixa-files").createSignedUrl(path, 60);
    if (error) setMessage(error.message); else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className={busy ? "app-shell busy" : "app-shell"}>
      <header className="topbar">
        <div className="brand"><span className="logo-mark"><Wallet size={21} /></span> Caixa Pessoal</div>
      </header>
      <main className="dashboard">
        <section className="dashboard-heading">
          <div><h1>Meu caixa</h1><p>Acompanhe seu saldo e suas transações.</p></div>
          <button className="primary-button" onClick={() => setDialogOpen(true)}><Plus size={20} /> Nova transação</button>
        </section>
        {message && <div className="notice" role="status">{message}</div>}
        <section className="summary-grid">
          <article className="summary-card"><span>Saldo atual</span><strong>{formatMoney(deposits - expenses)}</strong></article>
          <article className="summary-card"><span>Depósitos</span><strong className="positive">{formatMoney(deposits)}</strong></article>
          <article className="summary-card"><span>Despesas</span><strong className="negative">{formatMoney(expenses)}</strong></article>
        </section>
        <section className="transactions-panel">
          <header><h2>Transações</h2><div className="tabs"><button className={!showDeleted ? "active" : ""} onClick={() => setShowDeleted(false)}>Ativas</button><button className={showDeleted ? "active" : ""} onClick={() => setShowDeleted(true)}>Excluídas</button></div></header>
          {!visible.length ? <div className="empty-state">Nenhuma transação {showDeleted ? "excluída" : "cadastrada"}.</div> : visible.map((item) => (
            <article className="transaction-row" key={item.id}>
              <div><strong>{item.name}</strong><span>{item.type === "deposit" ? "Depósito" : "Despesa"}{item.receipt_name ? " · comprovante anexado" : ""}</span></div>
              <time>{formatDate(item.occurred_on)}</time>
              <b className={item.type === "deposit" ? "positive" : "negative"}>{item.type === "deposit" ? "+ " : "− "}{formatMoney(item.amount_cents)}</b>
              <div className="row-actions">
                {item.receipt_path && <button onClick={() => openReceipt(item.receipt_path!)} aria-label="Abrir comprovante"><Paperclip size={18} /></button>}
                <button onClick={() => toggleDeleted(item)} aria-label={item.deleted_at ? "Restaurar" : "Excluir"}>{item.deleted_at ? <ArchiveRestore size={18} /> : <Trash2 size={18} />}</button>
              </div>
            </article>
          ))}
        </section>
      </main>
      {dialogOpen && <div className="modal-backdrop" onMouseDown={() => setDialogOpen(false)}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><h2 id="dialog-title">Nova transação</h2><button className="icon-button" onClick={() => setDialogOpen(false)} aria-label="Fechar"><X size={20} /></button></header>
          <form ref={formRef} onSubmit={submit}>
            <div className="form-grid">
              <label>Tipo<select name="type"><option value="deposit">Depósito</option><option value="expense">Despesa</option></select></label>
              <label>Nome<input name="name" required maxLength={120} placeholder="Ex.: Pagamento recebido" /></label>
              <label>Data<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <label>Valor<input name="amount" required inputMode="decimal" placeholder="0,00" /></label>
              <label className="wide-field">Comprovante opcional<input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png" /></label>
            </div>
            <footer><button type="button" className="secondary-button" onClick={() => setDialogOpen(false)}>Cancelar</button><button className="primary-button" disabled={busy}>Salvar transação</button></footer>
          </form>
        </section>
      </div>}
    </div>
  );
}
