-- Every Canadian jurisdiction level (federal → provincial/territorial → regional → municipal,
-- plus Indigenous lands), and jurisdictions added by users.

ALTER TABLE jurisdictions ALTER COLUMN name TYPE VARCHAR(200);
ALTER TABLE jurisdictions ALTER COLUMN code TYPE VARCHAR(100);

-- Kind of jurisdiction within its level, e.g. "Regional district", "Township", "Indian reserve"
ALTER TABLE jurisdictions ADD COLUMN subtype VARCHAR(80);

-- NULL for the official list; otherwise the user who added it (visible only to them)
ALTER TABLE jurisdictions ADD COLUMN created_by UUID REFERENCES users (id) ON DELETE CASCADE;
CREATE INDEX jurisdictions_created_by_idx ON jurisdictions (created_by) WHERE created_by IS NOT NULL;

-- Deleting a user removes their documents and their own jurisdictions in one statement. NO ACTION
-- (checked at the end of the statement) still blocks deleting a jurisdiction that is in use, but
-- unlike RESTRICT it lets those cascades complete together.
ALTER TABLE document_jurisdictions DROP CONSTRAINT document_jurisdictions_jurisdiction_id_fkey;
ALTER TABLE document_jurisdictions ADD CONSTRAINT document_jurisdictions_jurisdiction_id_fkey
  FOREIGN KEY (jurisdiction_id) REFERENCES jurisdictions (id) ON DELETE NO ACTION;
