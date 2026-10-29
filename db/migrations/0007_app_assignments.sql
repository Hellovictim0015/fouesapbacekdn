-- Apps the admin has assigned to a specific student by hand. They are shown to that student in addition to the apps that
-- match what the student typed they are preparing for, and first in the list.
CREATE TABLE user_app_assignments (
  user_id    CHAR(36)     NOT NULL,
  app_id     INT          NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (user_id, app_id),
  KEY idx_assign_app (app_id),
  CONSTRAINT fk_assign_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_assign_app FOREIGN KEY (app_id) REFERENCES recommended_apps (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
