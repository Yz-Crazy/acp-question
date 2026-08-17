import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { AppLayout } from "./components/AppLayout";
import { AuthPage } from "./pages/AuthPage";
import { AdminPage } from "./pages/AdminPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LibraryPage } from "./pages/LibraryPage";
import { MockExamPage } from "./pages/MockExamPage";
import { MockExamsPage } from "./pages/MockExamsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { QuizPage } from "./pages/QuizPage";
import { SearchPage } from "./pages/SearchPage";
import { WrongPage } from "./pages/WrongPage";

function FullPageLoader() {
  return (
    <div className="full-loader" role="status">
      <span className="brand-mark">题</span>
      <span className="loader-line" />
    </div>
  );
}

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <AuthPage />;
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="wrong" element={<WrongPage />} />
        <Route path="mock-exams" element={<MockExamsPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin" element={user.role === "admin" ? <AdminPage /> : <Navigate to="/" replace />} />
      </Route>
      <Route path="quiz" element={<QuizPage />} />
      <Route path="mock-exams/:examId" element={<MockExamPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
