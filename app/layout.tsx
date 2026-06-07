import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "5日線押し目チェッカー",
  description: "5日線押し目候補とテーマ資金を確認するローカルMVP"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="brand">
                5日線押し目チェッカー
              </Link>
              <nav className="nav" aria-label="主要ナビゲーション">
                <Link href="/">トップ</Link>
                <Link href="/candidates">候補一覧</Link>
                <Link href="/bb-watch">BB押し目一覧</Link>
                <Link href="/themes">投資テーマ</Link>
                <Link href="/help">使い方</Link>
              </nav>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
