import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
} from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";
import StudyLogPage from "./pages/StudyLogPage";
import HistoryPage from "./pages/HistoryPage";
import GoalsPage from "./pages/GoalsPage";
import AnalysisPage from "./pages/AnalysisPage";

/**
 * ルーティングと共通ヘッダー（ナビ・サインアウト）。
 */
export default function App() {
  const { user, signOut } = useAuthenticator();
  const loginLabel = user?.signInDetails?.loginId ?? "ユーザー";

  return (
    <BrowserRouter>
      <main className="app-main">
        <header className="app-header">
          <div className="app-brand-block">
            <Link to="/" className="app-brand-link" aria-label="ログ入力ページへ">
              <span className="app-logo" aria-hidden>
                <svg
                  className="app-logo-svg"
                  viewBox="0 0 32 32"
                  width={32}
                  height={32}
                  aria-hidden
                  focusable="false"
                >
                  <rect width="32" height="32" rx="8" fill="#5b4bce" />
                  <path
                    d="M9 19 L16 11 L23 19"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="16" cy="22" r="2.25" fill="#fff" opacity="0.95" />
                </svg>
              </span>
              <span className="app-brand">AI習慣コーチ</span>
            </Link>
            <p className="app-sub">{loginLabel}</p>
          </div>
          <nav className="app-nav" aria-label="メイン">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? "nav-link nav-link--active" : "nav-link"
              }
            >
              ログ入力
            </NavLink>
            <NavLink
              to="/goals"
              className={({ isActive }) =>
                isActive ? "nav-link nav-link--active" : "nav-link"
              }
            >
              目標の設定
            </NavLink>
            <NavLink
              to="/history"
              className={({ isActive }) =>
                isActive ? "nav-link nav-link--active" : "nav-link"
              }
            >
              過去の記録
            </NavLink>
            <NavLink
              to="/analysis"
              className={({ isActive }) =>
                isActive ? "nav-link nav-link--active" : "nav-link"
              }
            >
              分析
            </NavLink>
            <button type="button" className="btn-secondary" onClick={signOut}>
              サインアウト
            </button>
          </nav>
        </header>

        <Routes>
          <Route path="/" element={<StudyLogPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
