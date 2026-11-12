-- Phase 2, milestone M2: people and organisation structure (spec §3, §14).
--
-- These tables are the start of the relational model. They live next to the
-- phase 1 `documents` table, which keeps serving the current UI until the new
-- pages replace it.
--
-- Effective dating: rows that describe the structure carry `valid_from` and
-- `valid_to` (exclusive). A row is in effect on day D when
-- valid_from <= D AND (valid_to IS NULL OR D < valid_to).
-- Changes add rows instead of overwriting, so the structure on any past date
-- can be reconstructed (spec §14, decision 5).

-- `user` is a reserved word in Postgres, hence `app_user`.
CREATE TABLE IF NOT EXISTS app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_oid     text UNIQUE,                   -- Entra ID object id, set on SSO login
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  name          text,
  ui_language   text NOT NULL DEFAULT 'en-US' CHECK (ui_language IN ('en-US', 'zh-CN')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- A node's identity. Everything that can change over time is in org_node_version.
CREATE TABLE IF NOT EXISTS org_node (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES app_user (id)
);

CREATE TABLE IF NOT EXISTS org_node_version (
  id          bigserial PRIMARY KEY,
  node_id     uuid NOT NULL REFERENCES org_node (id),
  parent_id   uuid REFERENCES org_node (id),   -- NULL only for the group (root) node
  type        text NOT NULL,                   -- group, entity, brand, department, team (configurable)
  name_zh     text,
  name_en     text,
  valid_from  date NOT NULL,
  valid_to    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES app_user (id),
  CHECK (coalesce(name_zh, name_en) IS NOT NULL),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (parent_id IS DISTINCT FROM node_id)
);

-- At most one open-ended version per node; the services keep versions from overlapping.
CREATE UNIQUE INDEX IF NOT EXISTS org_node_version_open_idx
  ON org_node_version (node_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS org_node_version_node_idx ON org_node_version (node_id, valid_from);
CREATE INDEX IF NOT EXISTS org_node_version_parent_idx ON org_node_version (parent_id);

-- A person's place in the structure. One person can have several rows: several
-- nodes, or several roles on the same node (spec §3 "多重归属").
CREATE TABLE IF NOT EXISTS membership (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user (id),
  node_id     uuid NOT NULL REFERENCES org_node (id),
  role        text NOT NULL
              CHECK (role IN ('group_admin', 'entity_lead', 'team_lead', 'member', 'observer')),
  reports_to  uuid REFERENCES app_user (id),
  is_primary  boolean NOT NULL DEFAULT false,
  valid_from  date NOT NULL,
  valid_to    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES app_user (id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (reports_to IS DISTINCT FROM user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS membership_open_idx
  ON membership (user_id, node_id, role) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS membership_user_idx ON membership (user_id);
CREATE INDEX IF NOT EXISTS membership_node_idx ON membership (node_id);

-- Admin-configurable settings (spec §14 "setting"): key → JSON value.
CREATE TABLE IF NOT EXISTS setting (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES app_user (id)
);

-- Audit log for every business table (spec §6 "改动管控", §14 "revision").
CREATE TABLE IF NOT EXISTS revision (
  id          bigserial PRIMARY KEY,
  table_name  text NOT NULL,
  record_id   text NOT NULL,
  action      text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  actor_id    uuid REFERENCES app_user (id),
  source      text NOT NULL DEFAULT 'web',     -- web, teams, mcp:<client>, import, system
  reason      text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revision_record_idx ON revision (table_name, record_id);
CREATE INDEX IF NOT EXISTS revision_actor_idx ON revision (actor_id);
CREATE INDEX IF NOT EXISTS revision_created_idx ON revision (created_at);

-- Reporting view (Metabase etc.): the structure as it is today.
CREATE OR REPLACE VIEW org_current AS
  SELECT v.node_id AS id, v.parent_id, v.type, v.name_zh, v.name_en, v.valid_from
  FROM org_node_version v
  WHERE v.valid_from <= current_date AND (v.valid_to IS NULL OR current_date < v.valid_to);
