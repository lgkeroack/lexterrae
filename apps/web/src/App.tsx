import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoadingSpinner } from './components/LoadingSpinner';
import { AuthGuard } from './components/AuthGuard';

const LoginPage = React.lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const AuthCallbackPage = React.lazy(() =>
  import('./pages/AuthCallbackPage').then((m) => ({
    default: m.AuthCallbackPage,
  })),
);
const DocumentBrowserPage = React.lazy(() =>
  import('./pages/DocumentBrowserPage').then((m) => ({
    default: m.DocumentBrowserPage,
  })),
);
const UploadPage = React.lazy(() =>
  import('./pages/UploadPage').then((m) => ({ default: m.UploadPage })),
);
const DocumentDetailPage = React.lazy(() =>
  import('./pages/DocumentDetailPage').then((m) => ({
    default: m.DocumentDetailPage,
  })),
);

function SuspenseFallback() {
  return (
    <div className="flex h-screen items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<SuspenseFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to="/documents" replace />} />
          <Route path="/documents" element={<DocumentBrowserPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/documents/:id" element={<DocumentDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/documents" replace />} />
      </Routes>
    </Suspense>
  );
}
