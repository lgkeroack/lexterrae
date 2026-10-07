import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { DocumentList } from '../components/browser/DocumentList';

export function DocumentsPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Documents · Lex Terrae';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        {/* Styled link (not <Link><Button>) to avoid nesting interactive elements */}
        <Link
          to="/upload"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-dark focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Upload
        </Link>
      </div>
      <DocumentList />
    </div>
  );
}

// Re-export as DocumentBrowserPage for backward compatibility with App.tsx
export { DocumentsPage as DocumentBrowserPage };
