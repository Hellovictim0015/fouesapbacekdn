-- Foues schema, version 1. MySQL 8, InnoDB, utf8mb4. Times are UTC.
-- Applied by `npm run db:migrate` (scripts/migrate.mjs). Never edit a migration that has been applied:
-- add 0002_*.sql instead.

-- One row per account.
CREATE TABLE users (
  id             CHAR(36)     NOT NULL,
  auth_uid   VARCHAR(128) NOT NULL,
  name           VARCHAR(60)  NULL,
  email          VARCHAR(255) NULL,
  phone          VARCHAR(32)  NULL,
  exam           VARCHAR(16)  NULL,              -- Boards | JEE | NEET | UPSC | College | Other
  daily_goal_min INT          NOT NULL DEFAULT 240,
  created_at     DATETIME(3)  NOT NULL,
  updated_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_auth_uid (auth_uid),
  KEY idx_users_email (email),
  KEY idx_users_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The user's single Play subscription. The server, not the app, is the source of truth (Phase 6 fills it).
CREATE TABLE subscriptions (
  id                    CHAR(36)     NOT NULL,
  user_id               CHAR(36)     NOT NULL,
  product_id            VARCHAR(64)  NOT NULL,
  purchase_token        VARCHAR(512) NOT NULL,
  linked_purchase_token VARCHAR(512) NULL,       -- set when a resubscribe replaced an older token
  status                ENUM('NONE','TRIAL','ACTIVE','GRACE','EXPIRED') NOT NULL DEFAULT 'NONE',
  expires_at            DATETIME(3)  NULL,
  auto_renewing         TINYINT(1)   NOT NULL DEFAULT 0,
  acknowledged          TINYINT(1)   NOT NULL DEFAULT 0,
  latest_order_id       VARCHAR(64)  NULL,
  play_state            VARCHAR(64)  NULL,       -- raw subscriptionState, kept for debugging
  created_at            DATETIME(3)  NOT NULL,
  updated_at            DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscriptions_user (user_id),
  UNIQUE KEY uq_subscriptions_token (purchase_token),
  KEY idx_subscriptions_status_expiry (status, expires_at),
  CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-user, per-day AI counters (daily message limit) and the cached nudge line (Phase 7).
CREATE TABLE ai_usage (
  id         CHAR(36)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  day        DATE        NOT NULL,
  chat_count INT         NOT NULL DEFAULT 0,
  nudge_text TEXT        NULL,
  nudge_at   DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_usage_user_day (user_id, day),
  CONSTRAINT fk_ai_usage_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cloud backup of sessions + planner so a reinstall keeps the stats.
CREATE TABLE session_backups (
  user_id        CHAR(36)    NOT NULL,
  schema_version INT         NOT NULL DEFAULT 1,
  payload        JSON        NOT NULL,
  updated_at     DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_session_backups_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pub/Sub message ids already processed, so Play notification redeliveries are harmless (Phase 6).
CREATE TABLE play_notifications (
  message_id  VARCHAR(128) NOT NULL,
  received_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Admin-panel logins. Passwords are bcrypt hashes. Create them with `npm run admin:create`.
CREATE TABLE admins (
  id            CHAR(36)     NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  created_at    DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fixed-window request counters shared by all server instances (API limit, admin login attempts, AI limit).
CREATE TABLE rate_limits (
  key_name     VARCHAR(190)  NOT NULL,
  window_start INT UNSIGNED  NOT NULL,
  hits         INT           NOT NULL DEFAULT 0,
  PRIMARY KEY (key_name, window_start),
  KEY idx_rate_limits_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One pending login code per phone number. Only a keyed hash of the code is stored, never the code.
CREATE TABLE otp_codes (
  phone      VARCHAR(20)  NOT NULL,
  code_hash  CHAR(64)     NOT NULL,
  attempts   INT          NOT NULL DEFAULT 0,
  expires_at DATETIME(3)  NOT NULL,
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Signed-in devices. The app holds a random token; only its SHA-256 is stored, so a database leak
-- cannot be replayed. Deleting a row signs that device out; deleting a user removes all their rows.
CREATE TABLE auth_sessions (
  token_hash CHAR(64)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_auth_sessions_user (user_id),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
