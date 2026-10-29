-- Roles and parent/child links.
--   student : a normal account (buys its own plan)
--   parent  : can add up to 3 children and manage them; has a normal plan
--   child   : created by a parent, signs in with the parent's link code (no phone number), uses the PARENT's plan
ALTER TABLE users ADD COLUMN role ENUM('student','parent','child') NOT NULL DEFAULT 'student' AFTER auth_uid;

CREATE TABLE children (
  id                   CHAR(36)    NOT NULL,
  parent_user_id       CHAR(36)    NOT NULL,
  user_id              CHAR(36)    NOT NULL,           -- the child's own users row (role 'child')
  name                 VARCHAR(40) NOT NULL,
  enabled              TINYINT(1)  NOT NULL DEFAULT 1,  -- the parent can pause the child's access
  linked               TINYINT(1)  NOT NULL DEFAULT 0,  -- 1 once the child has signed in with a link code
  link_code_hash       CHAR(64)    NULL,                -- keyed hash of the code the child types once to sign in
  link_code_expires_at DATETIME(3) NULL,
  unlock_code_hash     CHAR(64)    NULL,                -- one-time code the parent reads out to allow uninstalling
  unlock_expires_at    DATETIME(3) NULL,
  unlock_attempts      INT         NOT NULL DEFAULT 0,
  created_at           DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_children_user (user_id),
  UNIQUE KEY uq_children_link (link_code_hash),
  KEY idx_children_parent (parent_user_id),
  CONSTRAINT fk_children_parent FOREIGN KEY (parent_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_children_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
