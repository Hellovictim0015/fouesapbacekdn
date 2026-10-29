-- What the student says they are preparing for, cleaned up by the AI (free text, optional).
ALTER TABLE users ADD COLUMN prep_goal VARCHAR(80) NULL AFTER exam;

-- The day's study-tip lines for the notifications (generated once per student per day).
ALTER TABLE ai_usage
  ADD COLUMN tips JSON NULL,
  ADD COLUMN tips_at DATETIME(3) NULL;
