import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { IndexPage } from './pages/IndexPage';
import { ReviewPage } from './pages/ReviewPage';
import { AdminListPage } from './pages/AdminListPage';
import { AdminDetailPage } from './pages/AdminDetailPage';

export function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/review/:id" element={<ReviewPage />} />
          <Route path="/admin" element={<AdminListPage />} />
          <Route path="/admin/:id" element={<AdminDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
