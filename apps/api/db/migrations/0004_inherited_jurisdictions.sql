-- A document tagged with a smaller jurisdiction (e.g. Toronto) also applies in its province and
-- in Canada. Those are stored as inherited tags so province and federal filters find it, while
-- the UI can tell them apart from the jurisdictions the user picked.

ALTER TABLE document_jurisdictions ADD COLUMN inherited BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing documents: every provincial/territorial and federal ancestor of a tag
WITH RECURSIVE up AS (
  SELECT dj.document_id, j.parent_id
  FROM document_jurisdictions dj JOIN jurisdictions j ON j.id = dj.jurisdiction_id
  UNION
  SELECT up.document_id, p.parent_id
  FROM up JOIN jurisdictions p ON p.id = up.parent_id
)
INSERT INTO document_jurisdictions (document_id, jurisdiction_id, inherited)
SELECT DISTINCT up.document_id, a.id, true
FROM up JOIN jurisdictions a ON a.id = up.parent_id
WHERE a.level IN ('provincial', 'territorial', 'federal')
ON CONFLICT (document_id, jurisdiction_id) DO NOTHING;
