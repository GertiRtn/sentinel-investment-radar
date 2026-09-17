CREATE TABLE `collector_run` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`attempted_at` text NOT NULL,
	`completed_at` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`raw_event_id` text,
	`error` text,
	FOREIGN KEY (`raw_event_id`) REFERENCES `raw_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collector_source_time` ON `collector_run` (`source`,`completed_at`);--> statement-breakpoint
CREATE TABLE `fact` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`metric` text NOT NULL,
	`value` real,
	`unit` text NOT NULL,
	`known_from` text NOT NULL,
	`raw_event_id` text NOT NULL,
	`derivation` text NOT NULL,
	FOREIGN KEY (`raw_event_id`) REFERENCES `raw_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fact_entity_known` ON `fact` (`entity`,`known_from`);--> statement-breakpoint
CREATE TABLE `raw_event` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text NOT NULL,
	`published_at` text,
	`known_from` text NOT NULL,
	`content_hash` text NOT NULL,
	`payload` text NOT NULL,
	`http_status` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_source_hash` ON `raw_event` (`source`,`content_hash`);--> statement-breakpoint
CREATE INDEX `raw_known_from` ON `raw_event` (`known_from`);--> statement-breakpoint
CREATE TABLE `signal_log` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`created_at` text NOT NULL,
	`kind` text NOT NULL,
	`entity` text,
	`body` text NOT NULL,
	`probability` real,
	`resolves_at` text
);
--> statement-breakpoint
CREATE INDEX `signal_owner_time` ON `signal_log` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `signal_resolution` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_id` text NOT NULL,
	`owner` text NOT NULL,
	`resolved_at` text NOT NULL,
	`outcome` integer NOT NULL,
	`evidence` text NOT NULL,
	FOREIGN KEY (`signal_id`) REFERENCES `signal_log`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resolution_signal` ON `signal_resolution` (`signal_id`);--> statement-breakpoint
CREATE TABLE `source_state` (
	`source` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`retry_at` text,
	`checked_at` text,
	`last_good_at` text,
	`raw_event_id` text,
	`lease_until` text,
	`lease_token` text,
	`error` text,
	FOREIGN KEY (`raw_event_id`) REFERENCES `raw_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_owner_revision` ON `workspace_revision` (`owner`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_owner_request` ON `workspace_revision` (`owner`,`id`);--> statement-breakpoint
CREATE TRIGGER raw_no_update BEFORE UPDATE ON raw_event BEGIN SELECT RAISE(ABORT, 'raw events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER raw_no_delete BEFORE DELETE ON raw_event BEGIN SELECT RAISE(ABORT, 'raw events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER facts_no_update BEFORE UPDATE ON fact BEGIN SELECT RAISE(ABORT, 'facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER facts_no_delete BEFORE DELETE ON fact BEGIN SELECT RAISE(ABORT, 'facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER signals_no_update BEFORE UPDATE ON signal_log BEGIN SELECT RAISE(ABORT, 'signals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER signals_no_delete BEFORE DELETE ON signal_log BEGIN SELECT RAISE(ABORT, 'signals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER resolution_no_update BEFORE UPDATE ON signal_resolution BEGIN SELECT RAISE(ABORT, 'resolutions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER resolution_no_delete BEFORE DELETE ON signal_resolution BEGIN SELECT RAISE(ABORT, 'resolutions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_no_update BEFORE UPDATE ON workspace_revision BEGIN SELECT RAISE(ABORT, 'workspace history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_no_delete BEFORE DELETE ON workspace_revision BEGIN SELECT RAISE(ABORT, 'workspace history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER runs_no_update BEFORE UPDATE ON collector_run BEGIN SELECT RAISE(ABORT, 'collection history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER runs_no_delete BEFORE DELETE ON collector_run BEGIN SELECT RAISE(ABORT, 'collection history is immutable'); END;
