-- Phase 1: the original Firestore collections are stored one-to-one as
-- documents in Postgres. Every Firestore document becomes one row; the path
-- is identical to the Firestore path (e.g. `keyResults/abc/progress/xyz`).
--
-- Values that JSON cannot express are tagged, see common/docstore/encoding.js:
--   references  {"__ref": "organizations/abc"}
--   timestamps  {"__ts": "2026-11-12T10:00:00.000Z"}
--
-- Phase 2 replaces this with the relational model in the functional spec §14.

CREATE TABLE IF NOT EXISTS documents (
  path        text PRIMARY KEY,
  collection  text NOT NULL,             -- full collection path, e.g. keyResults/abc/progress
  collection_group text NOT NULL,        -- last collection id, e.g. progress
  parent      text NOT NULL DEFAULT '',  -- parent document path, '' for root collections
  id          text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_collection_idx ON documents (collection);
CREATE INDEX IF NOT EXISTS documents_group_idx ON documents (collection_group);
CREATE INDEX IF NOT EXISTS documents_data_idx ON documents USING gin (data jsonb_path_ops);

-- Convenience views for reporting (Metabase etc.). One per collection.
CREATE OR REPLACE VIEW okr_organizations AS
  SELECT id, data->>'name' AS name, data->>'slug' AS slug,
         (data->>'archived')::boolean AS archived, data, created_at, updated_at
  FROM documents WHERE collection = 'organizations';

CREATE OR REPLACE VIEW okr_departments AS
  SELECT id, data->>'name' AS name, data->>'slug' AS slug,
         data->'organization'->>'__ref' AS organization,
         (data->>'archived')::boolean AS archived, data, created_at, updated_at
  FROM documents WHERE collection = 'departments';

CREATE OR REPLACE VIEW okr_products AS
  SELECT id, data->>'name' AS name, data->>'slug' AS slug,
         data->'organization'->>'__ref' AS organization,
         data->'department'->>'__ref' AS department,
         (data->>'archived')::boolean AS archived, data, created_at, updated_at
  FROM documents WHERE collection = 'products';

CREATE OR REPLACE VIEW okr_objectives AS
  SELECT id, data->>'name' AS name,
         data->'parent'->>'__ref' AS parent,
         (data->>'progression')::numeric AS progression,
         (data->>'weight')::numeric AS weight,
         (data->'startDate'->>'__ts')::timestamptz AS start_date,
         (data->'endDate'->>'__ts')::timestamptz AS end_date,
         (data->>'archived')::boolean AS archived, data, created_at, updated_at
  FROM documents WHERE collection = 'objectives';

CREATE OR REPLACE VIEW okr_key_results AS
  SELECT id, data->>'name' AS name,
         data->'objective'->>'__ref' AS objective,
         data->'parent'->>'__ref' AS parent,
         (data->>'startValue')::numeric AS start_value,
         (data->>'targetValue')::numeric AS target_value,
         (data->>'currentValue')::numeric AS current_value,
         (data->>'progression')::numeric AS progression,
         (data->>'weight')::numeric AS weight,
         data->>'unit' AS unit,
         (data->>'archived')::boolean AS archived, data, created_at, updated_at
  FROM documents WHERE collection = 'keyResults';

CREATE OR REPLACE VIEW okr_key_result_progress AS
  SELECT id, split_part(parent, '/', 2) AS key_result_id,
         (data->>'value')::numeric AS value,
         (data->'timestamp'->>'__ts')::timestamptz AS measured_at,
         data->>'comment' AS comment,
         data->'createdBy'->>'__ref' AS created_by,
         data, created_at, updated_at
  FROM documents WHERE collection_group = 'progress' AND parent LIKE 'keyResults/%';

CREATE OR REPLACE VIEW okr_kpis AS
  SELECT id, data->>'name' AS name, data->>'type' AS type,
         data->'parent'->>'__ref' AS parent,
         (data->>'currentValue')::numeric AS current_value,
         (data->>'archived')::boolean AS archived, data, created_at, updated_at
  FROM documents WHERE collection = 'kpis';

CREATE OR REPLACE VIEW okr_kpi_progress AS
  SELECT id, split_part(parent, '/', 2) AS kpi_id,
         (data->>'value')::numeric AS value,
         (data->'timestamp'->>'__ts')::timestamptz AS measured_at,
         data->>'comment' AS comment,
         data, created_at, updated_at
  FROM documents WHERE collection_group = 'progress' AND parent LIKE 'kpis/%';

CREATE OR REPLACE VIEW okr_audit AS
  SELECT id, data->>'event' AS event,
         (data->'timestamp'->>'__ts')::timestamptz AS happened_at,
         data->'documentRef'->>'__ref' AS document,
         COALESCE(data->'user'->>'__ref', data->>'user') AS user_path,
         data->'diff' AS diff, data
  FROM documents WHERE collection = 'audit';

CREATE OR REPLACE VIEW okr_users AS
  SELECT id AS email, data->>'displayName' AS display_name,
         COALESCE((data->>'superAdmin')::boolean, false) AS super_admin,
         data->'admin' AS admin_of, data, created_at, updated_at
  FROM documents WHERE collection = 'users';
