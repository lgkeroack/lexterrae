import React, { Suspense } from 'react';
import { Routes, Route, Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { FileQuestion, AlertTriangle } from 'lucide-react';
import { Layout } from './components/Layout';
import { LoadingSpinner } from './components/LoadingSpinner';
import { AuthGuard } from './components/AuthGuard';
import { AdminGuard, BackendGuard } from './components/BackendGuard';
import { useDocumentTitle } from './components/common/useDocumentTitle';

const LoginPage = React.lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = React.lazy(() =>
  import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })),
);
const GoogleCompletePage = React.lazy(() =>
  import('./pages/GoogleCompletePage').then((m) => ({ default: m.GoogleCompletePage })),
);
const DocumentBrowserPage = React.lazy(() =>
  import('./pages/DocumentBrowserPage').then((m) => ({
    default: m.DocumentBrowserPage,
  })),
);
const HomePage = React.lazy(() =>
  import('./pages/HomePage').then((m) => ({ default: m.HomePage })),
);
const UserFacingPage = React.lazy(() =>
  import('./pages/UserFacingPage').then((m) => ({ default: m.UserFacingPage })),
);
const UsersPage = React.lazy(() =>
  import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const UploadPage = React.lazy(() =>
  import('./pages/UploadPage').then((m) => ({ default: m.UploadPage })),
);
const DocumentDetailPage = React.lazy(() =>
  import('./pages/DocumentDetailPage').then((m) => ({
    default: m.DocumentDetailPage,
  })),
);

/** The user-facing page used to live at /user-facing; keep old links (and ?place=) working. */
function ToUserFacing() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/', search }} replace />;
}

function SuspenseFallback() {
  return (
    <div className="flex h-screen items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}

function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <FileQuestion className="mb-4 h-12 w-12 text-gray-400" aria-hidden="true" />
      <h1 className="text-xl font-semibold text-gray-900">Page not found</h1>
      <p className="mt-2 text-sm text-gray-600">
        The page you&apos;re looking for doesn&apos;t exist or may have been moved.
      </p>
      <Link
        to="/documents"
        className="mt-6 inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        Go to documents
      </Link>
    </div>
  );
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors and failed lazy-chunk loads (e.g. after a redeploy)
 * so the user sees a recovery option instead of a blank page.
 */
class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const isChunkError =
      /dynamically imported module|Loading chunk|Importing a module script/i.test(
        this.state.error.message,
      );
    return (
      <div role="alert" className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md rounded-lg bg-white p-8 text-center shadow-md">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-amber-500" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-gray-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-600">
            {isChunkError
              ? 'A new version of the app may be available. Reload the page to continue.'
              : 'An unexpected error occurred. Reloading the page usually fixes this.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

export function App() {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<SuspenseFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/auth/google/complete" element={<GoogleCompletePage />} />
          {/* Home: the public, user-facing page (also where users without backend access land) */}
          <Route index element={<UserFacingPage />} />
          <Route path="/user-facing" element={<ToUserFacing />} />
          {/* Everything else: signed in and authorized by an admin */}
          <Route
            element={
              <AuthGuard>
                <BackendGuard>
                  <Outlet />
                </BackendGuard>
              </AuthGuard>
            }
          >
            <Route path="/home" element={<HomePage />} />
            <Route element={<Layout />}>
              <Route path="/documents" element={<DocumentBrowserPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/documents/:id" element={<DocumentDetailPage />} />
              <Route
                path="/users"
                element={
                  <AdminGuard>
                    <UsersPage />
                  </AdminGuard>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}
