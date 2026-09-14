"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestore, ArrowDownLeft, ArrowUpRight, CalendarDays, Paperclip, Trash2, Wallet, X } from "lucide-react";
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
  const [transactionType, setTransactionType] = useState<"deposit" | "expense">("deposit");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const formRef = useRef<HTMLFormElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const active = transactions.filter((item) => !item.deleted_at);
  const deleted = transactions.filter((item) => item.deleted_at);
  const visible = showDeleted ? deleted : active;
  const deposits = active.filter((item) => item.type === "deposit").reduce((sum, item) => sum + item.amount_cents, 0);
  const expenses = active.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount_cents, 0);
  const formatMoney = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

  function openTransactionDialog(type: "deposit" | "expense") {
    setTransactionType(type);
    setDialogOpen(true);
  }

  async function refresh() {
    const { data, error } = await supabase.schema("caixa").from("transactions").select("*").order("occurred_on", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error;
    setTransactions(data ?? []);
  }

  useEffect(() => {
    async function loadTransactions() {
      const { data, error } = await supabase.schema("caixa").from("transactions").select("*").order("occurred_on", { ascending: false }).order("created_at", { ascending: false });
        if (error) { setMessageType("error"); setMessage(error.message); }
        else setTransactions(data ?? []);
      setLoading(false);
    }
    void loadTransactions();
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
      await refresh(); formRef.current?.reset(); setDialogOpen(false); setMessageType("success"); setMessage("Transação salva com sucesso.");
    } catch (error) { setMessageType("error"); setMessage(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }

  async function toggleDeleted(item: Transaction) {
    setBusy(true); setMessage("");
    const { error } = await supabase.schema("caixa").from("transactions").update({ deleted_at: item.deleted_at ? null : new Date().toISOString() }).eq("id", item.id);
    if (error) { setMessageType("error"); setMessage(error.message); }
    else { await refresh(); setMessageType("success"); setMessage(item.deleted_at ? "Transação restaurada." : "Transação movida para excluídas."); }
    setBusy(false);
  }

  async function openReceipt(path: string) {
    const { data, error } = await supabase.storage.from("caixa-files").createSignedUrl(path, 60);
    if (error) { setMessageType("error"); setMessage(error.message); } else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className={busy ? "app-shell busy" : "app-shell"}>
      <header className="topbar">
        <div className="brand"><span className="logo-mark"><Wallet size={21} /></span><span>Caixa Pessoal</span></div>
        <span className="privacy-label">Caixa único</span>
      </header>
      <main className="dashboard">
        <section className="dashboard-heading">
          <div><span className="eyebrow">Visão geral</span><h1>Meu caixa</h1><p>Entradas, despesas e comprovantes em um só lugar.</p></div>
          <div className="transaction-buttons">
            <button className="deposit-button" onClick={() => openTransactionDialog("deposit")}><ArrowDownLeft size={20} /> Novo depósito</button>
            <button className="expense-button" onClick={() => openTransactionDialog("expense")}><ArrowUpRight size={20} /> Nova despesa</button>
          </div>
        </section>
        {message && <div className={`notice ${messageType}`} role={messageType === "error" ? "alert" : "status"}>{message}</div>}
        <section className="summary-grid">
          <article className="summary-card balance-card"><span>Saldo disponível</span><strong>{formatMoney(deposits - expenses)}</strong><small>Calculado com as transações ativas</small></article>
          <article className="summary-card movement-card"><span className="summary-icon deposit"><ArrowDownLeft size={19} /></span><div><span>Depósitos</span><strong className="positive">{formatMoney(deposits)}</strong></div></article>
          <article className="summary-card movement-card"><span className="summary-icon expense"><ArrowUpRight size={19} /></span><div><span>Despesas</span><strong className="negative">{formatMoney(expenses)}</strong></div></article>
        </section>
        <section className="transactions-panel">
          <header><div><h2>Transações</h2><span className="panel-subtitle">{active.length} {active.length === 1 ? "registro ativo" : "registros ativos"}</span></div><div className="tabs"><button className={!showDeleted ? "active" : ""} onClick={() => setShowDeleted(false)}>Ativas <span>{active.length}</span></button><button className={showDeleted ? "active" : ""} onClick={() => setShowDeleted(true)}>Excluídas <span>{deleted.length}</span></button></div></header>
          {loading ? <div className="loading-state"><span className="spinner" /> Carregando transações...</div> : !visible.length ? <div className="empty-state"><span className="empty-icon">{showDeleted ? <Trash2 size={24} /> : <Wallet size={24} />}</span><strong>{showDeleted ? "Nenhuma transação excluída" : "Seu caixa está vazio"}</strong><p>{showDeleted ? "As transações removidas aparecerão aqui." : "Registre seu primeiro depósito ou despesa."}</p>{!showDeleted && <div className="empty-actions"><button className="deposit-button compact" onClick={() => openTransactionDialog("deposit")}><ArrowDownLeft size={18} /> Depósito</button><button className="expense-button compact" onClick={() => openTransactionDialog("expense")}><ArrowUpRight size={18} /> Despesa</button></div>}</div> : visible.map((item) => (
            <article className="transaction-row" key={item.id}>
              <span className={`transaction-icon ${item.type}`}>{item.type === "deposit" ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}</span>
              <div className="transaction-copy"><strong>{item.name}</strong><span>{item.type === "deposit" ? "Depósito" : "Despesa"}{item.receipt_name ? " · com comprovante" : ""}</span></div>
              <time><CalendarDays size={15} />{formatDate(item.occurred_on)}</time>
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
          <header><h2 id="dialog-title">{transactionType === "deposit" ? "Novo depósito" : "Nova despesa"}</h2><button className="icon-button" onClick={() => setDialogOpen(false)} aria-label="Fechar"><X size={20} /></button></header>
          <form ref={formRef} onSubmit={submit}>
            <div className="form-grid">
              <input name="type" type="hidden" value={transactionType} />
              <div className={`selected-type ${transactionType}`}><span className="summary-icon">{transactionType === "deposit" ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}</span><div><small>Tipo da transação</small><strong>{transactionType === "deposit" ? "Depósito" : "Despesa"}</strong></div></div>
              <label>Nome <span className="required">obrigatório</span><input name="name" required maxLength={120} placeholder="Ex.: Pagamento recebido" autoFocus /></label>
              <label>Data <span className="required">obrigatório</span><input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <label>Valor <span className="required">obrigatório</span><div className="money-input"><span>R$</span><input name="amount" required inputMode="decimal" placeholder="0,00" /></div></label>
              <label className="wide-field">Comprovante <span className="optional">opcional · PDF, JPG ou PNG até 10 MB</span><input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png" /></label>
            </div>
            <footer><button type="button" className="secondary-button" onClick={() => setDialogOpen(false)}>Cancelar</button><button className="primary-button" disabled={busy}>Salvar transação</button></footer>
          </form>
        </section>
      </div>}
    </div>
  );
}
