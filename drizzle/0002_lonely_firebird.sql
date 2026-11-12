CREATE INDEX discovery_case_lookup ON signal_log(owner, json_extract(body,'$.candidateId'), json_extract(body,'$.symbol')) WHERE kind='discovery_case';--> statement-breakpoint
CREATE INDEX discovery_attempt_lookup ON signal_log(owner, json_extract(body,'$.candidateId'), json_extract(body,'$.symbol'), created_at) WHERE kind='discovery_attempt';--> statement-breakpoint
CREATE INDEX outcome_case_lookup ON signal_log(owner, json_extract(body,'$.caseId')) WHERE kind='discovery_outcome';--> statement-breakpoint
CREATE INDEX outcome_attempt_lookup ON signal_log(owner, json_extract(body,'$.caseId'), created_at) WHERE kind='outcome_attempt';
