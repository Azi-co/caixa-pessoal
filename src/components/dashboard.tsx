"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import cnspLogo from "@/assets/cnsp-logo.png";

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
type AuditItem = { actor_name: string; action: "created" | "deleted" | "restored" | "updated"; happened_at: string };

export function Dashboard({ initialTransactions }: { initialTransactions: Transaction[] }) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [showDeleted, setShowDeleted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Transaction | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [auditTitle, setAuditTitle] = useState("");
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

  // Usabilidade, paginação e modais
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [formAmount, setFormAmount] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [confirmDeleteModal, setConfirmDeleteModal] = useState<Transaction | null>(null);
  const [previewReceipt, setPreviewReceipt] = useState<{ url: string; name: string; isPdf: boolean } | null>(null);

  function formatCurrencyDigits(digitsStr: string) {
    const digits = digitsStr.replace(/\D/g, "");
    if (!digits) return "";
    const cents = parseInt(digits, 10);
    return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const formRef = useRef<HTMLFormElement>(null);
  const supabase = useMemo(() => createClient(), []);

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

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginated = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return visible.slice(start, start + pageSize);
  }, [visible, safeCurrentPage, pageSize]);

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
    setFormAmount("");
    setDialogOpen(true);
  }

  async function refresh(activeManager: Manager | null = manager, activePin = managerPin) {
    const { data, error } = activeManager
      ? await supabase.schema("caixa").rpc("list_transactions", {
          p_manager_id: activeManager.id,
          p_pin: activePin,
        })
      : await supabase
          .schema("caixa")
          .from("transactions_public")
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
          .from("transactions_public")
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
      await refresh(activeManager, pin);
      setAuthOpen(false);
      setAuthError("");
      setMessageType("success");
      setMessage(`Acesso liberado para ${data}.`);
    }
    setBusy(false);
  }

  async function logout() {
    setManager(null);
    setManagerPin("");
    setShowDeleted(false);
    await refresh(null, "");
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
      if (!manager) throw new Error("Entre na área de gestão para continuar.");
      const id = crypto.randomUUID();
      const file = form.get("receipt") as File;
      let receiptPath: string | null = null;
      if (file?.size) {
        if (file.size > 10 * 1024 * 1024) throw new Error("O comprovante deve ter no máximo 10 MB.");
        const safeFileName = file.name.replace(/[\\/]/g, "_").replace(/\.\.+/g, ".").slice(-180);
        receiptPath = `${id}/${safeFileName}`;
        const { error: authorizationError } = await supabase.schema("caixa").rpc("authorize_receipt_upload", {
          p_manager_id: manager.id,
          p_pin: managerPin,
          p_transaction_id: id,
          p_receipt_path: receiptPath,
        });
        if (authorizationError) throw authorizationError;
        const { error } = await supabase.storage.from("caixa-files").upload(receiptPath, file);
        if (error) throw error;
      }
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

  async function openReceipt(path: string, receiptName?: string | null) {
    if (manager) {
      const { error: authorizationError } = await supabase.schema("caixa").rpc("authorize_receipt_read", {
        p_manager_id: manager.id,
        p_pin: managerPin,
        p_receipt_path: path,
      });
      if (authorizationError) {
        setMessageType("error");
        setMessage(authorizationError.message);
        return;
      }
    }
    const { data, error } = await supabase.storage.from("caixa-files").createSignedUrl(path, 60);
    if (error) {
      setMessageType("error");
      setMessage(error.message);
    } else {
      const isPdf = path.toLowerCase().endsWith(".pdf");
      setPreviewReceipt({ url: data.signedUrl, name: receiptName || "Comprovante", isPdf });
    }
  }

  async function openAudit(item: Transaction) {
    if (!manager) return;
    setBusy(true);
    const { data, error } = await supabase.schema("caixa").rpc("get_transaction_audit", {
      p_manager_id: manager.id, p_pin: managerPin, p_transaction_id: item.id,
    });
    setBusy(false);
    if (error) { setMessageType("error"); setMessage(error.message); return; }
    setAuditTitle(item.name); setAuditItems(data ?? []); setAuditOpen(true);
  }

  function openEditDialog(item: Transaction) {
    if (!manager) {
      setAuthError("");
      setAuthOpen(true);
      return;
    }
    setEditingItem(item);
    setEditAmount((item.amount_cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingItem || !manager) return;
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData(event.currentTarget);
      const amount = Number(String(form.get("amount")).replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor válido.");

      const { error } = await supabase.schema("caixa").rpc("update_transaction", {
        p_manager_id: manager.id,
        p_pin: managerPin,
        p_transaction_id: editingItem.id,
        p_name: String(form.get("name")).trim(),
        p_occurred_on: form.get("date"),
        p_amount_cents: Math.round(amount * 100),
        p_student_name: editingItem.type === "deposit" ? String(form.get("student_name")).trim() : null,
        p_class_name: editingItem.type === "deposit" ? String(form.get("class_name")).trim() : null,
        p_vendor_name: editingItem.type === "expense" ? String(form.get("vendor_name")).trim() : null,
      });

      if (error) throw error;

      await refresh();
      setEditingItem(null);
      setMessageType("success");
      setMessage("Transação atualizada com sucesso.");
    } catch (error) {
      setMessageType("error");
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar a transação.");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!visible.length) {
      setMessageType("error");
      setMessage("Nenhuma transação visível para exportar.");
      return;
    }

    const headers = manager
      ? ["Data", "Tipo", "Descrição", "Aluno", "Turma", "Local/Fornecedor", "Valor (R$)", "Responsável", "Status"]
      : ["Data", "Tipo", "Descrição", "Local/Fornecedor", "Valor (R$)"];

    const escapeCsv = (val: string | null | undefined) => {
      const s = String(val ?? "").trim();
      if (s.includes(";") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = visible.map((item) => {
      const date = formatDate(item.occurred_on);
      const type = item.type === "deposit" ? "Depósito" : "Despesa";
      const amount = (item.amount_cents / 100).toFixed(2).replace(".", ",");
      const signedAmount = item.type === "deposit" ? amount : `-${amount}`;

      if (manager) {
        return [
          date,
          type,
          escapeCsv(item.name),
          escapeCsv(item.student_name),
          escapeCsv(item.class_name),
          escapeCsv(item.vendor_name),
          signedAmount,
          escapeCsv(item.created_by_name),
          item.deleted_at ? "Excluída" : "Ativa",
        ].join(";");
      }

      return [
        date,
        type,
        escapeCsv(item.name),
        escapeCsv(item.vendor_name),
        signedAmount,
      ].join(";");
    });

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `extrato-caixa-escolar-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setMessageType("success");
    setMessage("Planilha CSV exportada com sucesso.");
  }

  return (
    <div className={busy ? "app-shell busy" : "app-shell"}>
      <header className="topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cnspLogo.src}
            alt="CNSP - Colégio N. Sra. dos Prazeres"
            className="school-logo"
          />
          <div className="brand-text">
            <strong>Colégio N. Sra. dos Prazeres</strong>
            <small>Portal da Transparência</small>
          </div>
        </div>
        {manager ? (
          <div className="manager-session">
            <span>
              {manager.display_name}
            </span>
            <button onClick={logout} aria-label="Sair da área de gestão" title="Sair da gestão">
              Sair
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
            Área da gestão
          </button>
        )}
      </header>

      <main className="dashboard">
        <section className="dashboard-heading">
          <div>
            <span className="eyebrow">Prestação de Contas Oficial</span>
            <h1>Caixa do Projeto</h1>
            <p>Acompanhe depósitos, despesas e comprovantes do CNSP com total transparência.</p>
          </div>
          {manager && (
            <div className="transaction-buttons">
              <button className="deposit-button" onClick={() => openTransactionDialog("deposit")}>
                Novo depósito
              </button>
              <button className="expense-button" onClick={() => openTransactionDialog("expense")}>
                Nova despesa
              </button>
            </div>
          )}
        </section>

        {message && (
          <div className={`notice ${messageType}`} role={messageType === "error" ? "alert" : "status"}>
            <div className="notice-content">
              <span>{message}</span>
            </div>
            <button className="notice-close" onClick={() => setMessage("")} aria-label="Fechar mensagem">
              fechar
            </button>
          </div>
        )}

        <section className="summary-grid">
          <article className="summary-card balance-card">
            <span className="card-tag">Disponibilidade</span>
            <strong>{formatMoney(deposits - expenses)}</strong>
            <small>Saldo líquido das transações ativas</small>
          </article>
          <article className="summary-card movement-card deposit-summary">
            <div>
              <span className="card-tag positive">Total Arrecadado</span>
              <strong className="positive">{formatMoney(deposits)}</strong>
              <small>{active.filter((i) => i.type === "deposit").length} depósitos registrados</small>
            </div>
          </article>
          <article className="summary-card movement-card expense-summary">
            <div>
              <span className="card-tag negative">Total Investido/Gasto</span>
              <strong className="negative">{formatMoney(expenses)}</strong>
              <small>{active.filter((i) => i.type === "expense").length} despesas registradas</small>
            </div>
          </article>
        </section>

        {deposits > 0 && (
          <section className="project-liquidity-card">
            <div className="liquidity-info">
              <div>
                <span className="eyebrow-small">Balanço do Projeto</span>
                <strong>
                  {Math.max(0, Math.min(100, Math.round(((deposits - expenses) / deposits) * 100)))}% dos recursos continuam em caixa
                </strong>
              </div>
              <span className="liquidity-meta">{active.length} movimentações registradas</span>
            </div>
            <div className="liquidity-bar-track">
              <div
                className="liquidity-bar-fill"
                style={{ width: `${Math.max(0, Math.min(100, Math.round(((deposits - expenses) / deposits) * 100)))}%` }}
              />
            </div>
          </section>
        )}

        <section className="transactions-panel">
          <header className="panel-header">
            <div className="panel-title-area">
              <h2>Extrato de Movimentações</h2>
              <span className="panel-subtitle">
                {visible.length} {visible.length === 1 ? "registro exibido" : "registros exibidos"}
              </span>
            </div>

            <div className="panel-controls">
              <button
                className="export-button"
                onClick={exportCsv}
                title="Exportar dados visíveis para planilha CSV"
              >
                Exportar CSV
              </button>
              {manager && (
                <div className="tabs">
                  <button
                    className={!showDeleted ? "active" : ""}
                    onClick={() => {
                      setShowDeleted(false);
                      setCurrentPage(1);
                    }}
                  >
                    Ativas <span>{active.length}</span>
                  </button>
                  <button
                    className={showDeleted ? "active" : ""}
                    onClick={() => {
                      setShowDeleted(true);
                      setCurrentPage(1);
                    }}
                  >
                    Excluídas <span>{deleted.length}</span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className="panel-filters-bar">
            <div className="search-box">
              <input
                type="text"
                placeholder="Buscar por aluno, descrição, turma ou fornecedor..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                aria-label="Buscar transações"
              />
              {searchQuery && (
                <button
                  className="clear-search"
                  onClick={() => {
                    setSearchQuery("");
                    setCurrentPage(1);
                  }}
                  aria-label="Limpar busca"
                >
                  limpar
                </button>
              )}
            </div>

            <div className="filter-pills">
              <button
                className={`filter-pill ${typeFilter === "all" ? "active" : ""}`}
                onClick={() => {
                  setTypeFilter("all");
                  setCurrentPage(1);
                }}
              >
                Todos ({visible.length})
              </button>
              <button
                className={`filter-pill deposit-pill ${typeFilter === "deposit" ? "active" : ""}`}
                onClick={() => {
                  setTypeFilter("deposit");
                  setCurrentPage(1);
                }}
              >
                Entradas ({active.filter((i) => i.type === "deposit").length})
              </button>
              <button
                className={`filter-pill expense-pill ${typeFilter === "expense" ? "active" : ""}`}
                onClick={() => {
                  setTypeFilter("expense");
                  setCurrentPage(1);
                }}
              >
                Saídas ({active.filter((i) => i.type === "expense").length})
              </button>
            </div>
          </div>

          {loading ? (
            <div className="loading-state">
              <span className="spinner" /> Carregando transações...
            </div>
          ) : !visible.length ? (
            <div className="empty-state">
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
                    Depósito
                  </button>
                  <button className="expense-button compact" onClick={() => openTransactionDialog("expense")}>
                    Despesa
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="transaction-list">
              {paginated.map((item) => (
                <article className="transaction-row" key={item.id}>
                  <span className={`transaction-icon ${item.type}`}>
                    {item.type === "deposit" ? "+" : "−"}
                  </span>

                  <div className="transaction-copy">
                    <div className="title-row">
                      <strong>{item.name}</strong>
                      <span className="mobile-date">
                        {formatDate(item.occurred_on)}
                      </span>
                    </div>

                    <div className="transaction-details">
                      <span className="details-text">
                        {item.type === "deposit"
                          ? [item.student_name, item.class_name].filter(Boolean).join(" · ") || "Depósito de aluno"
                          : item.vendor_name || "Despesa geral"}
                      </span>

                      {item.receipt_path && (manager || item.type === "expense") && (
                        <button
                          className="receipt-badge"
                          onClick={() => openReceipt(item.receipt_path!, item.receipt_name || item.name)}
                          title="Clique para visualizar o comprovante"
                        >
                          Ver comprovante
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
                    {formatDate(item.occurred_on)}
                  </time>

                  <b className={`amount-display ${item.type === "deposit" ? "positive" : "negative"}`}>
                    {item.type === "deposit" ? "+ " : "− "}
                    {formatMoney(item.amount_cents)}
                  </b>

                  <div className="row-actions">
                    {manager && !item.deleted_at && (
                      <button
                        className="action-btn edit"
                        onClick={() => openEditDialog(item)}
                        title="Editar transação"
                      >
                        Editar
                      </button>
                    )}
                    {manager && <button className="action-btn" onClick={() => openAudit(item)} title="Ver histórico de auditoria">Histórico</button>}
                    {manager && (
                      <button
                        className={`action-btn ${item.deleted_at ? "restore" : "delete"}`}
                        onClick={() => item.deleted_at ? void toggleDeleted(item) : setConfirmDeleteModal(item)}
                        aria-label={item.deleted_at ? "Restaurar" : "Excluir"}
                        title={item.deleted_at ? "Restaurar transação" : "Mover para lixeira"}
                      >
                        {item.deleted_at ? "Restaurar" : "Excluir"}
                      </button>
                    )}
                  </div>
                </article>
              ))}

              {visible.length > pageSize && (
                <footer className="pagination-bar">
                  <span className="pagination-info">
                    Exibindo <b>{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, visible.length)}</b> de <b>{visible.length}</b> movimentações
                  </span>
                  <div className="pagination-buttons">
                    <button
                      className="page-nav-btn"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      aria-label="Página anterior"
                    >
                      ← Anterior
                    </button>
                    <div className="page-numbers">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                        .map((page, idx, arr) => (
                          <span key={page} className="page-item-wrapper">
                            {idx > 0 && arr[idx - 1] !== page - 1 && <span className="page-ellipsis">…</span>}
                            <button
                              className={`page-num-btn ${currentPage === page ? "active" : ""}`}
                              onClick={() => setCurrentPage(page)}
                            >
                              {page}
                            </button>
                          </span>
                        ))}
                    </div>
                    <button
                      className="page-nav-btn"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Próxima página"
                    >
                      Próxima →
                    </button>
                  </div>
                </footer>
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cnspLogo.src} alt="CNSP" className="footer-logo" />
            <div>
              <strong>Colégio Nossa Senhora dos Prazeres</strong>
              <p>Portal da Transparência · Prestação de Contas do Projeto</p>
            </div>
          </div>

          <div className="footer-meta">
            <div className="footer-badge">
              <span className="footer-badge-dot" />
              <span>Transparência Ativa &amp; Registros Auditados</span>
            </div>
            <p className="footer-copy">
              Todos os lançamentos, despesas e comprovantes são armazenados em ambiente seguro com rastreabilidade individual.
            </p>
          </div>
        </div>

        <div className="footer-bottom">
          <small>© {new Date().getFullYear()} Colégio N. Sra. dos Prazeres. Todos os direitos reservados.</small>
          <small className="footer-tech">Tecnologia e Governança Azilab</small>
        </div>
      </footer>

      {auditOpen && <div className="modal-backdrop" onMouseDown={() => setAuditOpen(false)}>
        <section className="modal audit-modal" role="dialog" aria-modal="true" aria-labelledby="audit-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span className="eyebrow">Rastreabilidade</span><h2 id="audit-title">Histórico: {auditTitle}</h2></div><button className="icon-button" onClick={() => setAuditOpen(false)}>Fechar</button></header>
          <div className="audit-list">{auditItems.length ? auditItems.map((entry, index) => <article className="audit-item" key={`${entry.happened_at}-${index}`}><strong>{entry.action === "created" ? "Registro criado" : entry.action === "deleted" ? "Movido para excluídas" : entry.action === "updated" ? "Registro alterado" : "Registro restaurado"}</strong><span>por {entry.actor_name}</span><time>{formatDateTime(entry.happened_at)}</time></article>) : <p>Nenhum evento registrado.</p>}</div>
        </section>
      </div>}

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
                Fechar
              </button>
            </header>

            <form onSubmit={authenticate}>
              <p>Selecione seu nome e informe seu PIN individual de 6 dígitos para gerenciar o caixa.</p>

              {authError && (
                <div className="modal-notice error" role="alert">
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
                      {showPin ? "Ocultar" : "Mostrar"}
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
                Fechar
              </button>
            </header>

            <form ref={formRef} onSubmit={submit}>
              <div className="form-grid">
                <input name="type" type="hidden" value={transactionType} />
                <div className={`selected-type ${transactionType}`}>
                  <span className="summary-icon">
                    {transactionType === "deposit" ? "+" : "−"}
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
                    <input
                      name="amount"
                      required
                      inputMode="numeric"
                      value={formAmount}
                      onChange={(e) => setFormAmount(formatCurrencyDigits(e.target.value))}
                      placeholder="0,00"
                    />
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

      {/* Modal de Edição de Transação */}
      {editingItem && (
        <div className="modal-backdrop" onMouseDown={() => setEditingItem(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2 id="edit-dialog-title">{editingItem.type === "deposit" ? "Editar Depósito" : "Editar Despesa"}</h2>
              <button className="icon-button" onClick={() => setEditingItem(null)} aria-label="Fechar">
                Fechar
              </button>
            </header>

            <form onSubmit={submitEdit}>
              <div className="form-grid">
                <div className={`selected-type ${editingItem.type}`}>
                  <div>
                    <small>Tipo de Registro</small>
                    <strong>{editingItem.type === "deposit" ? "Depósito (Entrada)" : "Despesa (Saída)"}</strong>
                  </div>
                </div>

                <label>
                  Descrição <span className="required">obrigatório</span>
                  <input
                    name="name"
                    required
                    maxLength={120}
                    defaultValue={editingItem.name}
                    autoFocus
                  />
                </label>

                {editingItem.type === "deposit" ? (
                  <>
                    <label>
                      Nome do aluno <span className="required">obrigatório</span>
                      <input
                        name="student_name"
                        required
                        maxLength={120}
                        defaultValue={editingItem.student_name ?? ""}
                      />
                    </label>
                    <label>
                      Turma / Ano <span className="required">obrigatório</span>
                      <input
                        name="class_name"
                        required
                        maxLength={80}
                        defaultValue={editingItem.class_name ?? ""}
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    Local ou fornecedor <span className="required">obrigatório</span>
                    <input
                      name="vendor_name"
                      required
                      maxLength={160}
                      defaultValue={editingItem.vendor_name ?? ""}
                    />
                  </label>
                )}

                <label>
                  Data da movimentação <span className="required">obrigatório</span>
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={editingItem.occurred_on}
                  />
                </label>

                <label>
                  Valor <span className="required">obrigatório</span>
                  <div className="money-input">
                    <span>R$</span>
                    <input
                      name="amount"
                      required
                      inputMode="numeric"
                      value={editAmount}
                      onChange={(e) => setEditAmount(formatCurrencyDigits(e.target.value))}
                      placeholder="0,00"
                    />
                  </div>
                </label>
              </div>

              <footer>
                <button type="button" className="secondary-button" onClick={() => setEditingItem(null)}>
                  Cancelar
                </button>
                <button className="primary-button" disabled={busy}>
                  {busy ? "Salvando..." : "Salvar Alterações"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {confirmDeleteModal && (
        <div className="modal-backdrop" onMouseDown={() => setConfirmDeleteModal(null)}>
          <section
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow" style={{ color: "var(--outflow)" }}>Confirmação</span>
                <h2 id="confirm-title">Mover para a lixeira</h2>
              </div>
              <button className="icon-button" onClick={() => setConfirmDeleteModal(null)} aria-label="Fechar">
                Fechar
              </button>
            </header>
            <div className="modal-body-padded">
              <p>
                Tem certeza que deseja mover <strong>{confirmDeleteModal.name}</strong> ({formatMoney(confirmDeleteModal.amount_cents)}) para as excluídas?
              </p>
              <small className="audit-note">
                A movimentação continuará acessível na aba &quot;Excluídas&quot; e poderá ser restaurada a qualquer momento.
              </small>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setConfirmDeleteModal(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={() => {
                  const item = confirmDeleteModal;
                  setConfirmDeleteModal(null);
                  void toggleDeleted(item);
                }}
              >
                {busy ? "Excluindo..." : "Sim, mover para lixeira"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* Modal Lightbox de Comprovante (sem bloqueio de popup) */}
      {previewReceipt && (
        <div className="modal-backdrop receipt-lightbox" onMouseDown={() => setPreviewReceipt(null)}>
          <section
            className="modal lightbox-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">Comprovante Anexo</span>
                <h2 id="preview-title">{previewReceipt.name}</h2>
              </div>
              <div className="lightbox-header-actions">
                <a
                  href={previewReceipt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="secondary-button compact"
                >
                  Abrir original ↗
                </a>
                <button className="icon-button" onClick={() => setPreviewReceipt(null)} aria-label="Fechar comprovante">
                  ✕
                </button>
              </div>
            </header>
            <div className="lightbox-content">
              {previewReceipt.isPdf ? (
                <iframe
                  src={previewReceipt.url}
                  title={previewReceipt.name}
                  className="lightbox-iframe"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={previewReceipt.url}
                  alt={previewReceipt.name}
                  className="lightbox-image"
                />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
