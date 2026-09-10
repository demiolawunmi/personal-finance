CREATE TABLE report_runs(id TEXT PRIMARY KEY,report_type TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,currency TEXT NOT NULL,schema_version TEXT NOT NULL,metrics_json TEXT NOT NULL,data_health_json TEXT NOT NULL,generated_at TEXT NOT NULL,calculation_version TEXT NOT NULL,data_revision INTEGER NOT NULL,UNIQUE(report_type,period_start,period_end,currency,calculation_version,data_revision));
CREATE INDEX reports_period ON report_runs(period_start,currency);
CREATE TABLE audit_events(id TEXT PRIMARY KEY,timestamp TEXT NOT NULL,actor_type TEXT NOT NULL,actor_id TEXT NOT NULL,event_type TEXT NOT NULL,resource_type TEXT NOT NULL,resource_id TEXT,metadata_json TEXT NOT NULL);
CREATE INDEX audit_time ON audit_events(timestamp);
CREATE TABLE data_health_events(id TEXT PRIMARY KEY,item_id TEXT REFERENCES plaid_items(id) ON DELETE CASCADE,kind TEXT NOT NULL,severity TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT);
CREATE INDEX health_open ON data_health_events(resolved_at);
CREATE TABLE oauth_states(id TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,request_json TEXT,expires_at TEXT NOT NULL);
CREATE TABLE sessions(id_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf_token TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE oauth_consents(id TEXT PRIMARY KEY,session_hash TEXT NOT NULL REFERENCES sessions(id_hash) ON DELETE CASCADE,request_json TEXT NOT NULL,expires_at TEXT NOT NULL);
