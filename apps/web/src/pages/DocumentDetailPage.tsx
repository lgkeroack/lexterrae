import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { DocumentDetail } from '../components/browser/DocumentDetail';

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return <Navigate to="/documents" replace />;
  }

  // key: remount on id change so no local state (edit form, modal, preview) leaks between documents
  return <DocumentDetail key={id} documentId={id} />;
}
