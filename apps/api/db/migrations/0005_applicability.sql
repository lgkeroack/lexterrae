-- Applicability flows down, not up. A document applies where it is tagged and everywhere inside
-- that place: a case in Squamish gets the Squamish, British Columbia and Canada documents, but a
-- case in British Columbia does not get the Squamish one, and a case in Manitoba gets only the
-- Canada one. Documents are therefore tagged only with their own jurisdictions, and the
-- inherited province/Canada tags added by 0004 are removed (the API resolves applicability by
-- walking up from the case's jurisdiction instead).

DELETE FROM document_jurisdictions WHERE inherited;
ALTER TABLE document_jurisdictions DROP COLUMN inherited;
