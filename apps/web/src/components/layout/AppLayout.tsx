import React, { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { FileText, Upload, LogOut, Menu, X } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { formatTitle } from '../common/useDocumentTitle';
import { LoadingSpinner } from '../common/LoadingSpinner';

const navItems = [
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/upload', label: 'Upload', icon: Upload },
];

// Default tab titles per route; pages may refine with useDocumentTitle().
const routeTitles: { pattern: string; title: string }[] = [
  { pattern: '/documents/:id', title: 'Document details' },
  { pattern: '/documents', title: 'Documents' },
  { pattern: '/upload', title: 'Upload document' },
];

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (
    ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() ||
    '?'
  );
}

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Layout effect so a page's own useDocumentTitle (passive effect) wins.
  useLayoutEffect(() => {
    const match = routeTitles.find((r) => matchPath(r.pattern, location.pathname));
    document.title = formatTitle(match?.title);
  }, [location.pathname]);

  // Close the mobile drawer and reset scroll when the route changes.
  useEffect(() => {
    setSidebarOpen(false);
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [location.pathname]);

  // Mobile drawer: Escape closes it, focus moves in on open and back on close.
  useEffect(() => {
    if (!sidebarOpen) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const handleLogout = () => {
    // Navigate first so AuthGuard doesn't record this page as the post-login target.
    navigate('/login', { replace: true });
    logout();
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
    menuButtonRef.current?.focus();
  };

  return (
    <div className="flex h-screen h-dvh bg-white">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-white px-4 py-2 text-sm font-medium text-blue-700 shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Skip to main content
      </a>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        id="app-sidebar"
        aria-label="Sidebar"
        className={`
          fixed inset-y-0 left-0 z-30 w-64 max-w-[85vw] transform bg-white shadow-lg
          duration-200 ease-in-out
          lg:visible lg:relative lg:translate-x-0 lg:shadow-none lg:border-r lg:border-black
          ${
            // Becomes visible instantly on open (so focus can move in), but stays
            // visible until the slide-out finishes on close. Hidden drawer links
            // are removed from the tab order on mobile.
            sidebarOpen
              ? 'visible translate-x-0 transition-transform'
              : 'invisible -translate-x-full transition-[transform,visibility]'
          }
        `}
      >
        <div className="flex h-full flex-col">
          {/* Logo / Title */}
          <div className="flex h-16 items-center gap-2 border-b-4 border-double border-black px-6">
            <span className="text-2xl font-bold leading-none" aria-hidden="true">
              §
            </span>
            <span className="text-xl font-bold tracking-wide text-black [font-variant-caps:small-caps]">
              Lex Terrae
            </span>
            {/* Close button for mobile */}
            <button
              ref={closeButtonRef}
              type="button"
              className="-mr-2 ml-auto rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:hidden"
              onClick={closeSidebar}
              aria-label="Close navigation menu"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Navigation */}
          <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    isActive
                      ? 'bg-black text-white'
                      : 'text-black underline-offset-4 hover:underline'
                  }`
                }
              >
                <item.icon className="h-5 w-5" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* User info / Logout */}
          <div className="border-t border-black p-4">
            <div className="mb-3 flex items-center gap-3">
              <div
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center border border-black text-sm font-semibold text-black"
                aria-hidden="true"
              >
                {initials(user?.displayName)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {user?.displayName || 'Signed in'}
                </p>
                {user?.email && (
                  <p className="truncate text-xs text-gray-600" title={user.email}>
                    {user.email}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Log out
            </button>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="flex h-14 flex-shrink-0 items-center border-b-4 border-double border-black bg-white px-2 sm:px-4 lg:hidden">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Open navigation menu"
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="ml-2 flex items-center gap-2">
            <span className="text-xl font-bold leading-none" aria-hidden="true">
              §
            </span>
            <span className="text-lg font-bold tracking-wide text-black [font-variant-caps:small-caps]">
              Lex Terrae
            </span>
          </div>
        </header>

        {/* Page content */}
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 overflow-auto p-4 focus:outline-none sm:p-6"
        >
          {/* Keep the shell mounted while a lazy page chunk loads. */}
          <Suspense
            fallback={
              <div className="flex h-64 items-center justify-center">
                <LoadingSpinner size="lg" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
