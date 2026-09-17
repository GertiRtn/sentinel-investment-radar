CREATE TABLE `criterion_alert` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`evaluation_id` text NOT NULL,
	`known_from` text NOT NULL,
	`tier` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`evaluation_id`) REFERENCES `criterion_evaluation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `alert_owner_time` ON `criterion_alert` (`owner`,`known_from`);--> statement-breakpoint
CREATE TABLE `criterion_evaluation` (
	`id` text PRIMARY KEY NOT NULL,
	`kill_criterion_id` text NOT NULL,
	`evaluated_at` text NOT NULL,
	`as_of` text NOT NULL,
	`result` text NOT NULL,
	`reason` text NOT NULL,
	`inputs_json` text NOT NULL,
	`triggering_filing_id` text,
	`supersedes_id` text,
	`snapshot_json` text NOT NULL,
	FOREIGN KEY (`kill_criterion_id`) REFERENCES `kill_criterion`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `eval_criterion_time` ON `criterion_evaluation` (`kill_criterion_id`,`evaluated_at`);--> statement-breakpoint
CREATE TABLE `derived_metric` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real,
	`unit` text NOT NULL,
	`period_end` text NOT NULL,
	`known_from` text NOT NULL,
	`recorded_at` text NOT NULL,
	`inputs_json` text NOT NULL,
	`method` text NOT NULL,
	`confidence` text NOT NULL,
	`reason` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dm_entity_time` ON `derived_metric` (`entity_id`,`known_from`);--> statement-breakpoint
CREATE TABLE `entity` (
	`id` text PRIMARY KEY NOT NULL,
	`cik` text NOT NULL,
	`name` text NOT NULL,
	`tickers` text NOT NULL,
	`exchanges` text NOT NULL,
	`sic` text,
	`created_at` text NOT NULL,
	`raw_event_id` text NOT NULL,
	FOREIGN KEY (`raw_event_id`) REFERENCES `raw_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_cik` ON `entity` (`cik`);--> statement-breakpoint
CREATE TABLE `entity_watch` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`entity_id` text NOT NULL,
	`known_from` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_owner_entity` ON `entity_watch` (`owner`,`entity_id`);--> statement-breakpoint
CREATE TABLE `filing` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`accession` text NOT NULL,
	`form` text NOT NULL,
	`filed_at` text NOT NULL,
	`known_from` text NOT NULL,
	`period_end` text,
	`items` text,
	`primary_document` text,
	`raw_event_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_event_id`) REFERENCES `raw_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filing_accession` ON `filing` (`accession`);--> statement-breakpoint
CREATE INDEX `filing_entity_time` ON `filing` (`entity_id`,`known_from`);--> statement-breakpoint
CREATE TABLE `financial_fact` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`metric` text NOT NULL,
	`source_tag` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`fiscal_year` integer,
	`fiscal_period` text,
	`form` text NOT NULL,
	`known_from` text NOT NULL,
	`filed` text NOT NULL,
	`accession` text NOT NULL,
	`raw_event_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_event_id`) REFERENCES `raw_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ff_observation` ON `financial_fact` (`entity_id`,`source_tag`,`unit`,`period_start`,`period_end`,`accession`);--> statement-breakpoint
CREATE INDEX `ff_pit` ON `financial_fact` (`entity_id`,`known_from`,`metric`,`period_end`);--> statement-breakpoint
CREATE TABLE `kill_criterion` (
	`id` text PRIMARY KEY NOT NULL,
	`memo_id` text NOT NULL,
	`predicate_json` text NOT NULL,
	`known_from` text NOT NULL,
	`supersedes_id` text,
	`supersede_reason` text NOT NULL,
	FOREIGN KEY (`memo_id`) REFERENCES `research_memo`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `criterion_successor` ON `kill_criterion` (`supersedes_id`);--> statement-breakpoint
CREATE INDEX `criterion_memo` ON `kill_criterion` (`memo_id`,`known_from`);--> statement-breakpoint
CREATE TABLE `maintenance_estimate` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`entity_id` text NOT NULL,
	`period_end` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`method` text NOT NULL,
	`known_from` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `estimate_owner_entity` ON `maintenance_estimate` (`owner`,`entity_id`,`known_from`);--> statement-breakpoint
CREATE TABLE `research_memo` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`entity_id` text NOT NULL,
	`thesis` text NOT NULL,
	`position_open` integer NOT NULL,
	`known_from` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memo_owner` ON `research_memo` (`owner`,`known_from`);--> statement-breakpoint
CREATE TABLE `resolution_record` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_id` text NOT NULL,
	`owner` text NOT NULL,
	`resolved_at` text NOT NULL,
	`outcome` integer NOT NULL,
	`evidence` text NOT NULL,
	`source_url` text NOT NULL,
	`supersedes_id` text,
	`chain_key` text NOT NULL,
	FOREIGN KEY (`signal_id`) REFERENCES `signal_log`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resolution_chain_key` ON `resolution_record` (`chain_key`);--> statement-breakpoint
CREATE INDEX `resolution_record_signal_time` ON `resolution_record` (`signal_id`,`resolved_at`);--> statement-breakpoint
CREATE TABLE `sec_rate` (
	`id` text PRIMARY KEY NOT NULL,
	`tokens` real NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sec_run` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text,
	`known_from` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`raw_event_id` text
);
--> statement-breakpoint
CREATE INDEX `sec_run_entity_time` ON `sec_run` (`entity_id`,`known_from`);
--> statement-breakpoint
CREATE TRIGGER resolution_record_no_update BEFORE UPDATE ON resolution_record BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER resolution_record_no_delete BEFORE DELETE ON resolution_record BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER entity_no_update BEFORE UPDATE ON entity BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER entity_no_delete BEFORE DELETE ON entity BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER entity_watch_no_update BEFORE UPDATE ON entity_watch BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER entity_watch_no_delete BEFORE DELETE ON entity_watch BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER filing_no_update BEFORE UPDATE ON filing BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER filing_no_delete BEFORE DELETE ON filing BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER financial_fact_no_update BEFORE UPDATE ON financial_fact BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER financial_fact_no_delete BEFORE DELETE ON financial_fact BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER derived_metric_no_update BEFORE UPDATE ON derived_metric BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER derived_metric_no_delete BEFORE DELETE ON derived_metric BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER sec_run_no_update BEFORE UPDATE ON sec_run BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER sec_run_no_delete BEFORE DELETE ON sec_run BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER research_memo_no_update BEFORE UPDATE ON research_memo BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER research_memo_no_delete BEFORE DELETE ON research_memo BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER kill_criterion_no_update BEFORE UPDATE ON kill_criterion BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER kill_criterion_no_delete BEFORE DELETE ON kill_criterion BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER criterion_evaluation_no_update BEFORE UPDATE ON criterion_evaluation BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER criterion_evaluation_no_delete BEFORE DELETE ON criterion_evaluation BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER criterion_alert_no_update BEFORE UPDATE ON criterion_alert BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER criterion_alert_no_delete BEFORE DELETE ON criterion_alert BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER maintenance_estimate_no_update BEFORE UPDATE ON maintenance_estimate BEGIN SELECT RAISE(ABORT, 'immutable record'); END;

--> statement-breakpoint
CREATE TRIGGER maintenance_estimate_no_delete BEFORE DELETE ON maintenance_estimate BEGIN SELECT RAISE(ABORT, 'immutable record'); END;
