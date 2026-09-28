import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caixa do Projeto · CNSP",
  description: "Prestação de contas do Colégio Nossa Senhora dos Prazeres.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
