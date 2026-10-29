-- The prices the admin wants SHOWN in the app and on the terms page (rupees per month).
-- The amount Google Play actually charges is set in Play Console; the app shows Play's own price whenever it can,
-- and falls back to these numbers when Play is not available.
CREATE TABLE plan_prices (
  plan       ENUM('student','parent') NOT NULL,
  amount_inr INT          NOT NULL,
  updated_at DATETIME(3)  NOT NULL,
  updated_by VARCHAR(255) NOT NULL,
  PRIMARY KEY (plan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO plan_prices (plan, amount_inr, updated_at, updated_by) VALUES
  ('student', 49, UTC_TIMESTAMP(3), 'migration'),
  ('parent', 99, UTC_TIMESTAMP(3), 'migration');
