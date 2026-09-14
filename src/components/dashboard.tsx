"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestore, ArrowDownLeft, ArrowUpRight, CalendarDays, LogOut, Paperclip, ShieldCheck, Trash2, Wallet, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Transaction = {
  id: string;
  type: "deposit" | "expense";
  name: string;
  student_name: string | null;
  class_name: string | null;
  vendor_name: string | null;
  occurred_on: string;
  amount_cents: number;
  receipt_path: string | null;
  receipt_name: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
};

type Manager = { id: string; display_name: string };

export function Dashboard({ initialTransactions }: { initialTransactions: Transaction[] }) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [showDeleted, setShowDeleted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [transactionType, setTransactionType] = useState<"deposit" | "expense">("deposit");
  const [managers, setManagers] = useState<Manager[]>([]);
  const [manager, setManager] = useState<Manager | null>(null);
  const [managerPin, setManagerPin] = useState("");
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
  const formatDateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

  function openTransactionDialog(type: "deposit" | "expense") {
    if (!manager) { setAuthOpen(true); return; }
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
      const [{ data, error }, { data: managerData }] = await Promise.all([
        supabase.schema("caixa").from("transactions").select("*").order("occurred_on", { ascending: false }).order("created_at", { ascending: false }),
        supabase.schema("caixa").from("managers_public").select("*").order("display_name"),
      ]);
        if (error) { setMessageType("error"); setMessage(error.message); }
        else setTransactions(data ?? []);
      setManagers(managerData ?? []);
      setLoading(false);
    }
    void loadTransactions();
  }, [supabase]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const managerId = String(form.get("manager_id"));
    const pin = String(form.get("pin"));
    const { data, error } = await supabase.schema("caixa").rpc("authenticate_manager", { p_manager_id: managerId, p_pin: pin });
    if (error || !data) {
      setMessageType("error"); setMessage("Usuário ou PIN inválido.");
    } else {
      setManager(managers.find((item) => item.id === managerId) ?? { id: managerId, display_name: String(data) });
      setManagerPin(pin); setAuthOpen(false); setMessageType("success"); setMessage(`Acesso liberado para ${data}.`);
    }
    setBusy(false);
  }

  function logout() {
    setManager(null); setManagerPin(""); setShowDeleted(false);
    setMessageType("success"); setMessage("Você saiu da área de gestão.");
  }

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
      if (!manager) throw new Error("Entre na área de gestão para continuar.");
      const { error } = await supabase.schema("caixa").rpc("create_transaction", {
        p_manager_id: manager.id, p_pin: managerPin, p_id: id,
        p_type: form.get("type"), p_name: String(form.get("name")).trim(),
        p_occurred_on: form.get("date"), p_amount_cents: Math.round(amount * 100),
        p_student_name: form.get("type") === "deposit" ? String(form.get("student_name")).trim() : null,
        p_class_name: form.get("type") === "deposit" ? String(form.get("class_name")).trim() : null,
        p_vendor_name: form.get("type") === "expense" ? String(form.get("vendor_name")).trim() : null,
        p_receipt_path: receiptPath, p_receipt_name: file?.size ? file.name : null,
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
    if (!manager) { setAuthOpen(true); setBusy(false); return; }
    const { error } = await supabase.schema("caixa").rpc("set_transaction_deleted", { p_manager_id: manager.id, p_pin: managerPin, p_transaction_id: item.id, p_deleted: !item.deleted_at });
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
        <div className="brand"><span className="logo-mark"><Wallet size={21} /></span><span>Portal da Transparência</span></div>
        {manager ? <div className="manager-session"><span><ShieldCheck size={16} /> {manager.display_name}</span><button onClick={logout} aria-label="Sair da área de gestão"><LogOut size={17} /></button></div> : <button className="management-button" onClick={() => setAuthOpen(true)}><ShieldCheck size={17} /> Área da gestão</button>}
      </header>
      <main className="dashboard">
        <section className="dashboard-heading">
          <div><span className="eyebrow">Prestação de contas</span><h1>Caixa escolar</h1><p>Acompanhe depósitos, despesas e comprovantes.</p></div>
          {manager && <div className="transaction-buttons">
            <button className="deposit-button" onClick={() => openTransactionDialog("deposit")}><ArrowDownLeft size={20} /> Novo depósito</button>
            <button className="expense-button" onClick={() => openTransactionDialog("expense")}><ArrowUpRight size={20} /> Nova despesa</button>
          </div>}
        </section>
        {message && <div className={`notice ${messageType}`} role={messageType === "error" ? "alert" : "status"}>{message}</div>}
        <section className="summary-grid">
          <article className="summary-card balance-card"><span>Saldo disponível</span><strong>{formatMoney(deposits - expenses)}</strong><small>Calculado com as transações ativas</small></article>
          <article className="summary-card movement-card"><span className="summary-icon deposit"><ArrowDownLeft size={19} /></span><div><span>Depósitos</span><strong className="positive">{formatMoney(deposits)}</strong></div></article>
          <article className="summary-card movement-card"><span className="summary-icon expense"><ArrowUpRight size={19} /></span><div><span>Despesas</span><strong className="negative">{formatMoney(expenses)}</strong></div></article>
        </section>
        <section className="transactions-panel">
          <header><div><h2>Transações</h2><span className="panel-subtitle">{active.length} {active.length === 1 ? "registro ativo" : "registros ativos"}</span></div>{manager && <div className="tabs"><button className={!showDeleted ? "active" : ""} onClick={() => setShowDeleted(false)}>Ativas <span>{active.length}</span></button><button className={showDeleted ? "active" : ""} onClick={() => setShowDeleted(true)}>Excluídas <span>{deleted.length}</span></button></div>}</header>
          {loading ? <div className="loading-state"><span className="spinner" /> Carregando transações...</div> : !visible.length ? <div className="empty-state"><span className="empty-icon">{showDeleted ? <Trash2 size={24} /> : <Wallet size={24} />}</span><strong>{showDeleted ? "Nenhuma transação excluída" : "O caixa ainda está vazio"}</strong><p>{showDeleted ? "As transações removidas aparecerão aqui." : manager ? "Registre o primeiro depósito ou despesa." : "Os registros publicados pela gestão aparecerão aqui."}</p>{manager && !showDeleted && <div className="empty-actions"><button className="deposit-button compact" onClick={() => openTransactionDialog("deposit")}><ArrowDownLeft size={18} /> Depósito</button><button className="expense-button compact" onClick={() => openTransactionDialog("expense")}><ArrowUpRight size={18} /> Despesa</button></div>}</div> : visible.map((item) => (
            <article className="transaction-row" key={item.id}>
              <span className={`transaction-icon ${item.type}`}>{item.type === "deposit" ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}</span>
              <div className="transaction-copy"><strong>{item.name}</strong><span>{item.type === "deposit" ? [item.student_name, item.class_name].filter(Boolean).join(" · ") || "Depósito" : item.vendor_name || "Despesa"}{item.receipt_name ? " · com comprovante" : ""}</span>{item.created_by_name && <small>Registrado por {item.created_by_name} em {formatDateTime(item.created_at)}</small>}</div>
              <time><CalendarDays size={15} />{formatDate(item.occurred_on)}</time>
              <b className={item.type === "deposit" ? "positive" : "negative"}>{item.type === "deposit" ? "+ " : "− "}{formatMoney(item.amount_cents)}</b>
              <div className="row-actions">
                {item.receipt_path && <button onClick={() => openReceipt(item.receipt_path!)} aria-label="Abrir comprovante"><Paperclip size={18} /></button>}
                {manager && <button onClick={() => toggleDeleted(item)} aria-label={item.deleted_at ? "Restaurar" : "Excluir"}>{item.deleted_at ? <ArchiveRestore size={18} /> : <Trash2 size={18} />}</button>}
              </div>
            </article>
          ))}
        </section>
      </main>
      {authOpen && <div className="modal-backdrop" onMouseDown={() => setAuthOpen(false)}>
        <section className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span className="eyebrow">Acesso restrito</span><h2 id="auth-title">Área da gestão</h2></div><button className="icon-button" onClick={() => setAuthOpen(false)} aria-label="Fechar"><X size={20} /></button></header>
          <form onSubmit={authenticate}>
            <p>Selecione seu nome e informe seu PIN individual.</p>
            <div className="auth-fields">
              <label>Usuário<select name="manager_id" required defaultValue=""><option value="" disabled>Selecione seu nome</option>{managers.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
              <label>PIN<input name="pin" type="password" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6 números" /></label>
            </div>
            <footer><button type="button" className="secondary-button" onClick={() => setAuthOpen(false)}>Cancelar</button><button className="primary-button" disabled={busy}>Entrar</button></footer>
          </form>
        </section>
      </div>}
      {dialogOpen && <div className="modal-backdrop" onMouseDown={() => setDialogOpen(false)}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><h2 id="dialog-title">{transactionType === "deposit" ? "Novo depósito" : "Nova despesa"}</h2><button className="icon-button" onClick={() => setDialogOpen(false)} aria-label="Fechar"><X size={20} /></button></header>
          <form ref={formRef} onSubmit={submit}>
            <div className="form-grid">
              <input name="type" type="hidden" value={transactionType} />
              <div className={`selected-type ${transactionType}`}><span className="summary-icon">{transactionType === "deposit" ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}</span><div><small>Tipo da transação</small><strong>{transactionType === "deposit" ? "Depósito" : "Despesa"}</strong></div></div>
              <label>Descrição <span className="required">obrigatório</span><input name="name" required maxLength={120} placeholder={transactionType === "deposit" ? "Ex.: Mensalidade de setembro" : "Ex.: Material para atividade"} autoFocus /></label>
              {transactionType === "deposit" ? <>
                <label>Nome do aluno <span className="required">obrigatório</span><input name="student_name" required maxLength={120} placeholder="Nome completo" /></label>
                <label>Turma <span className="required">obrigatório</span><input name="class_name" required maxLength={80} placeholder="Ex.: 3º ano A" /></label>
              </> : <label>Local ou fornecedor <span className="required">obrigatório</span><input name="vendor_name" required maxLength={160} placeholder="Ex.: Papelaria Central" /></label>}
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
