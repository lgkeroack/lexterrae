-- When text extraction last ran for a document. NULL means not yet: the scheduled maintenance job
-- extracts text for those (Word, Excel and RTF uploads made before extraction existed, or an
-- upload whose extraction was interrupted).

ALTER TABLE documents ADD COLUMN text_checked_at TIMESTAMPTZ;

UPDATE documents SET text_checked_at = now()
WHERE content_text IS NOT NULL OR file_type NOT IN ('docx', 'xlsx', 'rtf');

CREATE INDEX documents_text_unchecked_idx ON documents (uploaded_at)
  WHERE text_checked_at IS NULL AND deleted_at IS NULL;
