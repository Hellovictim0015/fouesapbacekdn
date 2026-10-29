-- Messages the admin sends to students/parents/children. The app asks for new ones and shows them as notifications
-- (no push service: the phone checks every hour and whenever the app opens).
CREATE TABLE announcements (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  title          VARCHAR(80)  NOT NULL,
  body           VARCHAR(300) NOT NULL,
  audience       ENUM('all','students','parents','children','user') NOT NULL DEFAULT 'all',
  target_user_id CHAR(36)     NULL,        -- only for audience 'user'
  created_by     VARCHAR(255) NOT NULL,    -- the admin's email
  created_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_announcements_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
