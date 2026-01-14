import { useState } from "react";
import Header from "./components/Header.jsx";
import UnreadPage from "./pages/UnreadPage.jsx";
import SavedPage from "./pages/SavedPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";

const pages = {
  unread: { label: "未評価記事一覧" },
  saved: { label: "保存記事一覧" },
  settings: { label: "設定" }
};

export default function App() {
  const [page, setPage] = useState("unread");

  return (
    <div className="app">
      <Header page={page} onChange={setPage} pages={pages} />
      <main className="main">
        {page === "unread" && <UnreadPage />}
        {page === "saved" && <SavedPage />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}