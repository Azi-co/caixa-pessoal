"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Eye,
  EyeOff,
  LogOut,
  Paperclip,
  Search,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
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

const STORAGE_KEY = "caixa_manager_session_v1";

export function Dashboard({ initialTransactions }: { initialTransactions: Transaction[] }) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [showDeleted, setShowDeleted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [transactionType, setTransactionType] = useState<"deposit" | "expense">("deposit");
  const [managers, setManagers] = useState<Manager[]>([]);
  const [manager, setManager] = useState<Manager | null>(null);
  const [managerPin, setManagerPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  // Filtros e busca
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "deposit" | "expense">("all");

  const formRef = useRef<HTMLFormElement>(null);
  const supabase = useMemo(() => createClient(), []);

  // Restaurar sessão persistida do localStorage logo após montar no cliente
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.manager?.id && parsed?.pin) {
          setManager(parsed.manager);
          setManagerPin(parsed.pin);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const active = useMemo(() => transactions.filter((item) => !item.deleted_at), [transactions]);
  const deleted = useMemo(() => transactions.filter((item) => item.deleted_at), [transactions]);

  const deposits = useMemo(
    () => active.filter((item) => item.type === "deposit").reduce((sum, item) => sum + item.amount_cents, 0),
    [active]
  );
  const expenses = useMemo(
    () => active.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount_cents, 0),
    [active]
  );

  const visible = useMemo(() => {
    let list = showDeleted ? deleted : active;
    if (typeFilter !== "all") {
      list = list.filter((item) => item.type === typeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.student_name && item.student_name.toLowerCase().includes(q)) ||
          (item.class_name && item.class_name.toLowerCase().includes(q)) ||
          (item.vendor_name && item.vendor_name.toLowerCase().includes(q)) ||
          (item.created_by_name && item.created_by_name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [showDeleted, deleted, active, typeFilter, searchQuery]);

  const formatMoney = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

  // Auto-dismiss de mensagens de sucesso após 4.5s
  useEffect(() => {
    if (!message || messageType === "error") return;
    const timer = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(timer);
  }, [message, messageType]);

  function openTransactionDialog(type: "deposit" | "expense") {
    if (!manager) {
      setAuthError("");
      setAuthOpen(true);
      return;
    }
    setTransactionType(type);
    setDialogOpen(true);
  }

  async function refresh() {
    const { data, error } = await supabase
      .schema("caixa")
      .from("transactions")
      .select("*")
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    setTransactions(data ?? []);
  }

  useEffect(() => {
    async function loadTransactions() {
      const [{ data, error }, { data: managerData }] = await Promise.all([
        supabase
          .schema("caixa")
          .from("transactions")
          .select("*")
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase.schema("caixa").from("managers_public").select("*").order("display_name"),
      ]);
      if (error) {
        setMessageType("error");
        setMessage(error.message);
      } else {
        setTransactions(data ?? []);
      }
      setManagers(managerData ?? []);
      setLoading(false);
    }
    void loadTransactions();
  }, [supabase]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setAuthError("");
    const form = new FormData(event.currentTarget);
    const managerId = String(form.get("manager_id"));
    const pin = String(form.get("pin"));
    const { data, error } = await supabase
      .schema("caixa")
      .rpc("authenticate_manager", { p_manager_id: managerId, p_pin: pin });

    if (error) {
      setAuthError(`Não foi possível validar o acesso: ${error.message}`);
    } else if (!data) {
      setAuthError("PIN incorreto para o usuário selecionado.");
    } else {
      const activeManager = managers.find((item) => item.id === managerId) ?? { id: managerId, display_name: String(data) };
      setManager(activeManager);
      setManagerPin(pin);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ manager: activeManager, pin }));
      } catch {
        // ignora se localStorage estiver desabilitado
      }
      setAuthOpen(false);
      setAuthError("");
      setMessageType("success");
      setMessage(`Acesso liberado para ${data}.`);
    }
    setBusy(false);
  }

  function logout() {
    setManager(null);
    setManagerPin("");
    setShowDeleted(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignora
    }
    setMessageType("success");
    setMessage("Você saiu da área de gestão.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
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
        p_manager_id: manager.id,
        p_pin: managerPin,
        p_id: id,
        p_type: form.get("type"),
        p_name: String(form.get("name")).trim(),
        p_occurred_on: form.get("date"),
        p_amount_cents: Math.round(amount * 100),
        p_student_name: form.get("type") === "deposit" ? String(form.get("student_name")).trim() : null,
        p_class_name: form.get("type") === "deposit" ? String(form.get("class_name")).trim() : null,
        p_vendor_name: form.get("type") === "expense" ? String(form.get("vendor_name")).trim() : null,
        p_receipt_path: receiptPath,
        p_receipt_name: file?.size ? file.name : null,
      });
      if (error) {
        if (receiptPath) await supabase.storage.from("caixa-files").remove([receiptPath]);
        throw error;
      }
      await refresh();
      formRef.current?.reset();
      setDialogOpen(false);
      setMessageType("success");
      setMessage("Transação salva com sucesso.");
    } catch (error) {
      setMessageType("error");
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDeleted(item: Transaction) {
    setBusy(true);
    setMessage("");
    if (!manager) {
      setAuthError("");
      setAuthOpen(true);
      setBusy(false);
      return;
    }
    const { error } = await supabase
      .schema("caixa")
      .rpc("set_transaction_deleted", {
        p_manager_id: manager.id,
        p_pin: managerPin,
        p_transaction_id: item.id,
        p_deleted: !item.deleted_at,
      });
    if (error) {
      setMessageType("error");
      setMessage(error.message);
    } else {
      await refresh();
      setMessageType("success");
      setMessage(item.deleted_at ? "Transação restaurada." : "Transação movida para excluídas.");
    }
    setBusy(false);
  }

  async function openReceipt(path: string) {
    const { data, error } = await supabase.storage.from("caixa-files").createSignedUrl(path, 60);
    if (error) {
      setMessageType("error");
      setMessage(error.message);
    } else {
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className={busy ? "app-shell busy" : "app-shell"}>
      <header className="topbar">
        <div className="brand">
          <span className="logo-mark">
            <Wallet size={21} />
          </span>
          <div>
            <strong>Instituto Pio XII</strong>
            <small>Portal da Transparência Escolar</small>
          </div>
        </div>
        {manager ? (
          <div className="manager-session">
            <span>
              <ShieldCheck size={16} /> {manager.display_name}
            </span>
            <button onClick={logout} aria-label="Sair da área de gestão" title="Sair da gestão">
              <LogOut size={17} />
            </button>
          </div>
        ) : (
          <button
            className="management-button"
            onClick={() => {
              setAuthError("");
              setAuthOpen(true);
            }}
          >
            <ShieldCheck size={17} /> Área da gestão
          </button>
        )}
      </header>

      <main className="dashboard">
        <section className="dashboard-heading">
          <div>
            <span className="eyebrow">Prestação de Contas</span>
            <h1>Caixa Escolar</h1>
            <p>Acompanhe depósitos, despesas e comprovantes com total transparência.</p>
          </div>
          {manager && (
            <div className="transaction-buttons">
              <button className="deposit-button" onClick={() => openTransactionDialog("deposit")}>
                <ArrowDownLeft size={20} /> Novo depósito
              </button>
              <button className="expense-button" onClick={() => openTransactionDialog("expense")}>
                <ArrowUpRight size={20} /> Nova despesa
              </button>
            </div>
          )}
        </section>

        {message && (
          <div className={`notice ${messageType}`} role={messageType === "error" ? "alert" : "status"}>
            <div className="notice-content">
              {messageType === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <span>{message}</span>
            </div>
            <button className="notice-close" onClick={() => setMessage("")} aria-label="Fechar mensagem">
              <X size={16} />
            </button>
          </div>
        )}

        <section className="summary-grid">
          <article className="summary-card balance-card">
            <span>Saldo em caixa</span>
            <strong>{formatMoney(deposits - expenses)}</strong>
            <small>Saldo líquido das transações ativas</small>
          </article>
          <article className="summary-card movement-card">
            <span className="summary-icon deposit">
              <ArrowDownLeft size={20} />
            </span>
            <div>
              <span>Entradas (Depósitos)</span>
              <strong className="positive">{formatMoney(deposits)}</strong>
              <small>{active.filter((i) => i.type === "deposit").length} registros</small>
            </div>
          </article>
          <article className="summary-card movement-card">
            <span className="summary-icon expense">
              <ArrowUpRight size={20} />
            </span>
            <div>
              <span>Saídas (Despesas)</span>
              <strong className="negative">{formatMoney(expenses)}</strong>
              <small>{active.filter((i) => i.type === "expense").length} registros</small>
            </div>
          </article>
        </section>

        <section className="transactions-panel">
          <header className="panel-header">
            <div className="panel-title-area">
              <h2>Extrato de Movimentações</h2>
              <span className="panel-subtitle">
                {visible.length} {visible.length === 1 ? "registro exibido" : "registros exibidos"}
              </span>
            </div>

            <div className="panel-controls">
              {manager && (
                <div className="tabs">
                  <button className={!showDeleted ? "active" : ""} onClick={() => setShowDeleted(false)}>
                    Ativas <span>{active.length}</span>
                  </button>
                  <button className={showDeleted ? "active" : ""} onClick={() => setShowDeleted(true)}>
                    Excluídas <span>{deleted.length}</span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className="panel-filters-bar">
            <div className="search-box">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Buscar por aluno, descrição, turma ou fornecedor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Buscar transações"
              />
              {searchQuery && (
                <button className="clear-search" onClick={() => setSearchQuery("")} aria-label="Limpar busca">
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="filter-pills">
              <button
                className={`filter-pill ${typeFilter === "all" ? "active" : ""}`}
                onClick={() => setTypeFilter("all")}
              >
                Todos
              </button>
              <button
                className={`filter-pill deposit-pill ${typeFilter === "deposit" ? "active" : ""}`}
                onClick={() => setTypeFilter("deposit")}
              >
                <ArrowDownLeft size={14} /> Entradas
              </button>
              <button
                className={`filter-pill expense-pill ${typeFilter === "expense" ? "active" : ""}`}
                onClick={() => setTypeFilter("expense")}
              >
                <ArrowUpRight size={14} /> Saídas
              </button>
            </div>
          </div>

          {loading ? (
            <div className="loading-state">
              <span className="spinner" /> Carregando transações...
            </div>
          ) : !visible.length ? (
            <div className="empty-state">
              <span className="empty-icon">{showDeleted ? <Trash2 size={24} /> : <Wallet size={24} />}</span>
              <strong>
                {searchQuery || typeFilter !== "all"
                  ? "Nenhum resultado encontrado"
                  : showDeleted
                  ? "Nenhuma transação excluída"
                  : "O caixa ainda está vazio"}
              </strong>
              <p>
                {searchQuery || typeFilter !== "all"
                  ? "Tente buscar com outros termos ou limpe os filtros."
                  : showDeleted
                  ? "As transações removidas aparecerão aqui."
                  : manager
                  ? "Registre o primeiro depósito ou despesa."
                  : "Os registros publicados pela gestão aparecerão aqui."}
              </p>
              {searchQuery || typeFilter !== "all" ? (
                <button
                  className="secondary-button compact"
                  onClick={() => {
                    setSearchQuery("");
                    setTypeFilter("all");
                  }}
                >
                  Limpar filtros
                </button>
              ) : manager && !showDeleted ? (
                <div className="empty-actions">
                  <button className="deposit-button compact" onClick={() => openTransactionDialog("deposit")}>
                    <ArrowDownLeft size={18} /> Depósito
                  </button>
                  <button className="expense-button compact" onClick={() => openTransactionDialog("expense")}>
                    <ArrowUpRight size={18} /> Despesa
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="transaction-list">
              {visible.map((item) => (
                <article className="transaction-row" key={item.id}>
                  <span className={`transaction-icon ${item.type}`}>
                    {item.type === "deposit" ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}
                  </span>

                  <div className="transaction-copy">
                    <div className="title-row">
                      <strong>{item.name}</strong>
                      <span className="mobile-date">
                        <CalendarDays size={13} /> {formatDate(item.occurred_on)}
                      </span>
                    </div>

                    <div className="transaction-details">
                      <span className="details-text">
                        {item.type === "deposit"
                          ? [item.student_name, item.class_name].filter(Boolean).join(" · ") || "Depósito de aluno"
                          : item.vendor_name || "Despesa geral"}
                      </span>

                      {item.receipt_path && (
                        <button
                          className="receipt-badge"
                          onClick={() => openReceipt(item.receipt_path!)}
                          title="Clique para abrir o comprovante"
                        >
                          <Paperclip size={13} /> Comprovante
                        </button>
                      )}
                    </div>

                    {item.created_by_name && (
                      <small className="audit-note">
                        Registrado por <b>{item.created_by_name}</b> em {formatDateTime(item.created_at)}
                      </small>
                    )}
                  </div>

                  <time className="desktop-time">
                    <CalendarDays size={15} />
                    {formatDate(item.occurred_on)}
                  </time>

                  <b className={`amount-display ${item.type === "deposit" ? "positive" : "negative"}`}>
                    {item.type === "deposit" ? "+ " : "− "}
                    {formatMoney(item.amount_cents)}
                  </b>

                  <div className="row-actions">
                    {item.receipt_path && (
                      <button
                        className="action-btn"
                        onClick={() => openReceipt(item.receipt_path!)}
                        aria-label="Abrir comprovante"
                        title="Ver comprovante"
                      >
                        <Paperclip size={18} />
                      </button>
                    )}
                    {manager && (
                      <button
                        className={`action-btn ${item.deleted_at ? "restore" : "delete"}`}
                        onClick={() => toggleDeleted(item)}
                        aria-label={item.deleted_at ? "Restaurar" : "Excluir"}
                        title={item.deleted_at ? "Restaurar transação" : "Mover para lixeira"}
                      >
                        {item.deleted_at ? <ArchiveRestore size={18} /> : <Trash2 size={18} />}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Modal de Autenticação / Área da Gestão */}
      {authOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAuthOpen(false)}>
          <section
            className="modal auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">Acesso Restrito</span>
                <h2 id="auth-title">Área da Gestão</h2>
              </div>
              <button className="icon-button" onClick={() => setAuthOpen(false)} aria-label="Fechar">
                <X size={20} />
              </button>
            </header>

            <form onSubmit={authenticate}>
              <p>Selecione seu nome e informe seu PIN individual de 6 dígitos para gerenciar o caixa.</p>

              {authError && (
                <div className="modal-notice error" role="alert">
                  <AlertCircle size={17} />
                  <span>{authError}</span>
                </div>
              )}

              <div className="auth-fields">
                <label>
                  Usuário responsável
                  <select name="manager_id" required defaultValue="">
                    <option value="" disabled>
                      Selecione seu nome
                    </option>
                    {managers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.display_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  PIN de segurança
                  <div className="pin-input-container">
                    <input
                      name="pin"
                      type={showPin ? "text" : "password"}
                      required
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      placeholder="6 números (ex: 123456)"
                      onChange={() => setAuthError("")}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="pin-toggle"
                      onClick={() => setShowPin(!showPin)}
                      aria-label={showPin ? "Ocultar PIN" : "Mostrar PIN"}
                    >
                      {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </label>
              </div>

              <footer>
                <button type="button" className="secondary-button" onClick={() => setAuthOpen(false)}>
                  Cancelar
                </button>
                <button className="primary-button" disabled={busy}>
                  {busy ? "Validando..." : "Liberar Acesso"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {/* Modal de Nova Transação */}
      {dialogOpen && (
        <div className="modal-backdrop" onMouseDown={() => setDialogOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2 id="dialog-title">{transactionType === "deposit" ? "Novo Depósito" : "Nova Despesa"}</h2>
              <button className="icon-button" onClick={() => setDialogOpen(false)} aria-label="Fechar">
                <X size={20} />
              </button>
            </header>

            <form ref={formRef} onSubmit={submit}>
              <div className="form-grid">
                <input name="type" type="hidden" value={transactionType} />
                <div className={`selected-type ${transactionType}`}>
                  <span className="summary-icon">
                    {transactionType === "deposit" ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}
                  </span>
                  <div>
                    <small>Tipo de Registro</small>
                    <strong>{transactionType === "deposit" ? "Depósito (Entrada)" : "Despesa (Saída)"}</strong>
                  </div>
                </div>

                <label>
                  Descrição <span className="required">obrigatório</span>
                  <input
                    name="name"
                    required
                    maxLength={120}
                    placeholder={transactionType === "deposit" ? "Ex.: Mensalidade de setembro" : "Ex.: Material escolar"}
                    autoFocus
                  />
                </label>

                {transactionType === "deposit" ? (
                  <>
                    <label>
                      Nome do aluno <span className="required">obrigatório</span>
                      <input name="student_name" required maxLength={120} placeholder="Nome completo do aluno" />
                    </label>
                    <label>
                      Turma / Ano <span className="required">obrigatório</span>
                      <input name="class_name" required maxLength={80} placeholder="Ex.: 3º ano A" />
                    </label>
                  </>
                ) : (
                  <label>
                    Local ou fornecedor <span className="required">obrigatório</span>
                    <input name="vendor_name" required maxLength={160} placeholder="Ex.: Papelaria Central" />
                  </label>
                )}

                <label>
                  Data da movimentação <span className="required">obrigatório</span>
                  <input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
                </label>

                <label>
                  Valor <span className="required">obrigatório</span>
                  <div className="money-input">
                    <span>R$</span>
                    <input name="amount" required inputMode="decimal" placeholder="0,00" />
                  </div>
                </label>

                <label className="wide-field">
                  Comprovante <span className="optional">opcional · PDF, JPG ou PNG até 10 MB</span>
                  <input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png" />
                </label>
              </div>

              <footer>
                <button type="button" className="secondary-button" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </button>
                <button className="primary-button" disabled={busy}>
                  {busy ? "Salvando..." : "Salvar Transação"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
