-- Partner / own apps the admin wants to suggest to students (shown on Home and offered by Buddy).
-- `keywords` are the exams/courses the app is for (lower case). A student sees the app only if their
-- "preparing for" text contains one of them. The AI fills the keywords in when an app is created; the admin can edit them.
CREATE TABLE recommended_apps (
  id         INT          NOT NULL AUTO_INCREMENT,
  name       VARCHAR(60)  NOT NULL,
  tagline    VARCHAR(160) NOT NULL,                 -- what the app helps with
  url        VARCHAR(500) NOT NULL,                 -- https link (Play Store page or website)
  keywords   JSON         NOT NULL,                 -- ["gate", "gate cse", ...]
  logo       MEDIUMBLOB   NULL,                     -- PNG / JPEG / WebP, at most 150 KB
  logo_type  VARCHAR(20)  NULL,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_by VARCHAR(255) NOT NULL,
  created_at DATETIME(3)  NOT NULL,
  updated_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
