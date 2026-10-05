import React, { useEffect } from 'react';
import { UploadPanel } from '../components/upload/UploadPanel';

export function UploadPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Upload Document · Lex Terrae';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Upload Document</h1>
        <p className="mt-1 text-sm text-gray-500">
          Add a document (PDF, Word, Excel, CSV, RTF, text or image), describe it, and tag the
          Canadian jurisdictions it applies to.
        </p>
      </div>
      <UploadPanel />
    </div>
  );
}
