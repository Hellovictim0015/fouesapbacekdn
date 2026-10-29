-- Razorpay payments. Keys typed in the admin panel live in app_settings (secrets are stored encrypted).
CREATE TABLE app_settings (
  k          VARCHAR(64)  NOT NULL,
  v          TEXT         NOT NULL,
  is_secret  TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at DATETIME(3)  NOT NULL,
  updated_by VARCHAR(255) NOT NULL,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per checkout we started, so a webhook can find whose subscription it is.
CREATE TABLE pay_attempts (
  subscription_id VARCHAR(64) NOT NULL,
  user_id         CHAR(36)    NOT NULL,
  tier            ENUM('student','parent') NOT NULL,
  amount_paise    INT         NOT NULL,
  trial           TINYINT(1)  NOT NULL DEFAULT 0,
  created_at      DATETIME(3) NOT NULL,
  PRIMARY KEY (subscription_id),
  KEY idx_pay_attempts_user (user_id),
  CONSTRAINT fk_pay_attempts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every payment Razorpay tells us about. Kept for the books even if the user deletes their account (user_id becomes NULL, the phone stays).
CREATE TABLE payments (
  payment_id      VARCHAR(64)  NOT NULL,
  user_id         CHAR(36)     NULL,
  subscription_id VARCHAR(64)  NULL,
  tier            ENUM('student','parent') NULL,
  amount_paise    INT          NOT NULL,
  currency        VARCHAR(8)   NOT NULL DEFAULT 'INR',
  status          VARCHAR(24)  NOT NULL,           -- authorized | captured | failed | refunded
  method          VARCHAR(24)  NULL,               -- upi | card | netbanking | wallet | emandate ...
  detail          VARCHAR(120) NULL,               -- "visa 4242", UPI id, bank code
  phone           VARCHAR(20)  NULL,
  email           VARCHAR(255) NULL,
  error_code      VARCHAR(64)  NULL,
  error_text      VARCHAR(255) NULL,
  created_at      DATETIME(3)  NOT NULL,
  updated_at      DATETIME(3)  NOT NULL,
  PRIMARY KEY (payment_id),
  KEY idx_payments_created (created_at),
  KEY idx_payments_user (user_id),
  CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Webhook event ids already handled (Razorpay may deliver twice).
CREATE TABLE pay_events (
  event_id    VARCHAR(128) NOT NULL,
  received_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
