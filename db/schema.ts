import {sqliteTable,text,integer,real,uniqueIndex,index} from 'drizzle-orm/sqlite-core';
export const workspaceRevision=sqliteTable('workspace_revision',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),revision:integer('revision').notNull(),createdAt:text('created_at').notNull(),data:text('data').notNull(),
},t=>[uniqueIndex('workspace_owner_revision').on(t.owner,t.revision),uniqueIndex('workspace_owner_request').on(t.owner,t.id)]);
export const rawEvent=sqliteTable('raw_event',{
 id:text('id').primaryKey(),source:text('source').notNull(),fetchedAt:text('fetched_at').notNull(),publishedAt:text('published_at'),knownFrom:text('known_from').notNull(),contentHash:text('content_hash').notNull(),payload:text('payload').notNull(),httpStatus:integer('http_status').notNull(),
},t=>[uniqueIndex('raw_source_hash').on(t.source,t.contentHash),index('raw_known_from').on(t.knownFrom)]);
export const fact=sqliteTable('fact',{
 id:text('id').primaryKey(),entity:text('entity').notNull(),metric:text('metric').notNull(),value:real('value'),unit:text('unit').notNull(),knownFrom:text('known_from').notNull(),rawEventId:text('raw_event_id').notNull().references(()=>rawEvent.id),derivation:text('derivation').notNull(),
},t=>[index('fact_entity_known').on(t.entity,t.knownFrom)]);
export const collectorRun=sqliteTable('collector_run',{
 id:text('id').primaryKey(),source:text('source').notNull(),attemptedAt:text('attempted_at').notNull(),completedAt:text('completed_at').notNull(),status:text('status').notNull(),attempts:integer('attempts').notNull(),rawEventId:text('raw_event_id').references(()=>rawEvent.id),error:text('error'),
},t=>[index('collector_source_time').on(t.source,t.completedAt)]);
export const sourceState=sqliteTable('source_state',{
 source:text('source').primaryKey(),failures:integer('failures').notNull().default(0),retryAt:text('retry_at'),checkedAt:text('checked_at'),lastGoodAt:text('last_good_at'),rawEventId:text('raw_event_id').references(()=>rawEvent.id),leaseUntil:text('lease_until'),leaseToken:text('lease_token'),error:text('error'),
});
export const signalLog=sqliteTable('signal_log',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),createdAt:text('created_at').notNull(),kind:text('kind').notNull(),entity:text('entity'),body:text('body').notNull(),probability:real('probability'),resolvesAt:text('resolves_at'),
},t=>[index('signal_owner_time').on(t.owner,t.createdAt)]);
export const signalResolution=sqliteTable('signal_resolution',{
 id:text('id').primaryKey(),signalId:text('signal_id').notNull().references(()=>signalLog.id),owner:text('owner').notNull(),resolvedAt:text('resolved_at').notNull(),outcome:integer('outcome').notNull(),evidence:text('evidence').notNull(),
},t=>[uniqueIndex('resolution_signal').on(t.signalId)]);

// Additive work-order 03 records. Older resolutions stay untouched.
export const resolutionRecord=sqliteTable('resolution_record',{
 id:text('id').primaryKey(),signalId:text('signal_id').notNull().references(()=>signalLog.id),owner:text('owner').notNull(),resolvedAt:text('resolved_at').notNull(),outcome:integer('outcome').notNull(),evidence:text('evidence').notNull(),sourceUrl:text('source_url').notNull(),supersedesId:text('supersedes_id'),chainKey:text('chain_key').notNull(),
},t=>[uniqueIndex('resolution_chain_key').on(t.chainKey),index('resolution_record_signal_time').on(t.signalId,t.resolvedAt)]);
export const entity=sqliteTable('entity',{
 id:text('id').primaryKey(),cik:text('cik').notNull(),name:text('name').notNull(),tickers:text('tickers').notNull(),exchanges:text('exchanges').notNull(),sic:text('sic'),createdAt:text('created_at').notNull(),rawEventId:text('raw_event_id').notNull().references(()=>rawEvent.id),
},t=>[uniqueIndex('entity_cik').on(t.cik)]);
export const entityWatch=sqliteTable('entity_watch',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),entityId:text('entity_id').notNull().references(()=>entity.id),knownFrom:text('known_from').notNull(),
},t=>[uniqueIndex('watch_owner_entity').on(t.owner,t.entityId)]);
export const filing=sqliteTable('filing',{
 id:text('id').primaryKey(),entityId:text('entity_id').notNull().references(()=>entity.id),accession:text('accession').notNull(),form:text('form').notNull(),filedAt:text('filed_at').notNull(),knownFrom:text('known_from').notNull(),periodEnd:text('period_end'),items:text('items'),primaryDocument:text('primary_document'),rawEventId:text('raw_event_id').notNull().references(()=>rawEvent.id),recordedAt:text('recorded_at').notNull(),
},t=>[uniqueIndex('filing_accession').on(t.accession),index('filing_entity_time').on(t.entityId,t.knownFrom)]);
export const financialFact=sqliteTable('financial_fact',{
 id:text('id').primaryKey(),entityId:text('entity_id').notNull().references(()=>entity.id),metric:text('metric').notNull(),sourceTag:text('source_tag').notNull(),value:real('value').notNull(),unit:text('unit').notNull(),periodStart:text('period_start').notNull(),periodEnd:text('period_end').notNull(),fiscalYear:integer('fiscal_year'),fiscalPeriod:text('fiscal_period'),form:text('form').notNull(),knownFrom:text('known_from').notNull(),filed:text('filed').notNull(),accession:text('accession').notNull(),rawEventId:text('raw_event_id').notNull().references(()=>rawEvent.id),recordedAt:text('recorded_at').notNull(),
},t=>[uniqueIndex('ff_observation').on(t.entityId,t.sourceTag,t.unit,t.periodStart,t.periodEnd,t.accession),index('ff_pit').on(t.entityId,t.knownFrom,t.metric,t.periodEnd)]);
export const derivedMetric=sqliteTable('derived_metric',{
 id:text('id').primaryKey(),entityId:text('entity_id').notNull().references(()=>entity.id),metric:text('metric').notNull(),value:real('value'),unit:text('unit').notNull(),periodEnd:text('period_end').notNull(),knownFrom:text('known_from').notNull(),recordedAt:text('recorded_at').notNull(),inputsJson:text('inputs_json').notNull(),method:text('method').notNull(),confidence:text('confidence').notNull(),reason:text('reason').notNull(),
},t=>[index('dm_entity_time').on(t.entityId,t.knownFrom)]);
export const secRate=sqliteTable('sec_rate',{id:text('id').primaryKey(),tokens:real('tokens').notNull(),updatedAt:integer('updated_at').notNull()});
export const secRun=sqliteTable('sec_run',{id:text('id').primaryKey(),entityId:text('entity_id'),knownFrom:text('known_from').notNull(),status:text('status').notNull(),message:text('message').notNull(),rawEventId:text('raw_event_id')},t=>[index('sec_run_entity_time').on(t.entityId,t.knownFrom)]);
export const researchMemo=sqliteTable('research_memo',{id:text('id').primaryKey(),owner:text('owner').notNull(),entityId:text('entity_id').notNull().references(()=>entity.id),thesis:text('thesis').notNull(),positionOpen:integer('position_open').notNull(),knownFrom:text('known_from').notNull()},t=>[index('memo_owner').on(t.owner,t.knownFrom)]);
export const killCriterion=sqliteTable('kill_criterion',{id:text('id').primaryKey(),memoId:text('memo_id').notNull().references(()=>researchMemo.id),predicateJson:text('predicate_json').notNull(),knownFrom:text('known_from').notNull(),supersedesId:text('supersedes_id'),supersedeReason:text('supersede_reason').notNull()},t=>[uniqueIndex('criterion_successor').on(t.supersedesId),index('criterion_memo').on(t.memoId,t.knownFrom)]);
export const criterionEvaluation=sqliteTable('criterion_evaluation',{id:text('id').primaryKey(),criterionId:text('kill_criterion_id').notNull().references(()=>killCriterion.id),evaluatedAt:text('evaluated_at').notNull(),asOf:text('as_of').notNull(),result:text('result').notNull(),reason:text('reason').notNull(),inputsJson:text('inputs_json').notNull(),triggeringFilingId:text('triggering_filing_id'),supersedesId:text('supersedes_id'),snapshotJson:text('snapshot_json').notNull()},t=>[index('eval_criterion_time').on(t.criterionId,t.evaluatedAt)]);
export const criterionAlert=sqliteTable('criterion_alert',{id:text('id').primaryKey(),owner:text('owner').notNull(),evaluationId:text('evaluation_id').notNull().references(()=>criterionEvaluation.id),knownFrom:text('known_from').notNull(),tier:text('tier').notNull(),body:text('body').notNull()},t=>[index('alert_owner_time').on(t.owner,t.knownFrom)]);
export const maintenanceEstimate=sqliteTable('maintenance_estimate',{id:text('id').primaryKey(),owner:text('owner').notNull(),entityId:text('entity_id').notNull().references(()=>entity.id),periodEnd:text('period_end').notNull(),value:real('value').notNull(),unit:text('unit').notNull(),method:text('method').notNull(),knownFrom:text('known_from').notNull()},t=>[index('estimate_owner_entity').on(t.owner,t.entityId,t.knownFrom)]);
