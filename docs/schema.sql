-- TiketiKE / ChainTix database schema (PostgreSQL 16)
-- Generated from app/models/models.py (alembic head)

CREATE TYPE organizerverificationstatus AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE eventstatus AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'SOLD_OUT', 'CANCELLED', 'COMPLETED');
CREATE TYPE notificationstatus AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TYPE organizerrole AS ENUM ('OWNER', 'STAFF');
CREATE TYPE tierstatus AS ENUM ('ACTIVE', 'SOLD_OUT', 'CLOSED');
CREATE TYPE gatescannerstatus AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE pricecapchangetype AS ENUM ('INITIAL', 'ADJUSTED');
CREATE TYPE ticketstatus AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'USED', 'CANCELLED', 'RESALE');
CREATE TYPE attendancestatus AS ENUM ('ADMITTED', 'DENIED');
CREATE TYPE barcodestatus AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE paymentstatus AS ENUM ('INITIATED', 'SUCCESS', 'FAILED', 'TIMEOUT');
CREATE TYPE transfertype AS ENUM ('RESALE', 'GIFT');
CREATE TYPE transferstatus AS ENUM ('LISTED', 'PAUSED', 'PENDING_PAYMENT', 'PAID', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'SETTLEMENT_FAILED');
CREATE TYPE wallettransactiontype AS ENUM ('SALE', 'WITHDRAWAL');
CREATE TYPE wallettransactionstatus AS ENUM ('SUCCESS', 'PENDING', 'FAILED');
CREATE TYPE payoutstatus AS ENUM ('PENDING_APPROVAL', 'PROCESSING', 'PAID', 'FAILED', 'REJECTED');

CREATE TABLE organizers (
	id VARCHAR(36) NOT NULL, 
	business_name VARCHAR(255) NOT NULL, 
	kra_pin VARCHAR(20), 
	verification_status organizerverificationstatus NOT NULL, 
	mpesa_paybill VARCHAR(20), 
	royalty_wallet_address VARCHAR(42), 
	contact_email VARCHAR(255), 
	contact_phone VARCHAR(15), 
	payout_method VARCHAR(20), 
	payout_destination VARCHAR(50), 
	payout_account VARCHAR(20), 
	payout_label VARCHAR(100), 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	review_reason TEXT, 
	reviewed_at TIMESTAMP WITHOUT TIME ZONE, 
	suspended_at TIMESTAMP WITHOUT TIME ZONE, 
	suspended_reason TEXT, 
	PRIMARY KEY (id)
);

CREATE TABLE users (
	id VARCHAR(36) NOT NULL, 
	phone_number VARCHAR(15) NOT NULL, 
	phone_verified BOOLEAN DEFAULT true NOT NULL, 
	display_name VARCHAR(100), 
	email VARCHAR(255), 
	email_verified BOOLEAN DEFAULT false NOT NULL, 
	google_sub VARCHAR(255), 
	session_version INTEGER DEFAULT '0' NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	wallet_address VARCHAR(42), 
	external_wallet_address VARCHAR(42), 
	is_organizer BOOLEAN NOT NULL, 
	is_platform_admin BOOLEAN NOT NULL, 
	platform_admin_role VARCHAR(20), 
	platform_admin_since TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	UNIQUE (email)
);

CREATE UNIQUE INDEX ix_users_google_sub ON users (google_sub);
CREATE UNIQUE INDEX ix_users_phone_number ON users (phone_number);

CREATE TABLE admin_invites (
	id VARCHAR(36) NOT NULL, 
	phone_number VARCHAR(15) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	invited_by VARCHAR(36), 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (phone_number), 
	FOREIGN KEY(invited_by) REFERENCES users (id)
);

CREATE TABLE audit_logs (
	id VARCHAR(36) NOT NULL, 
	actor_id VARCHAR(36), 
	action_type VARCHAR(50) NOT NULL, 
	target_id VARCHAR(36), 
	target_type VARCHAR(50), 
	details TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(actor_id) REFERENCES users (id)
);

CREATE TABLE broadcasts (
	id VARCHAR(36) NOT NULL, 
	message TEXT NOT NULL, 
	channels JSON NOT NULL, 
	audience VARCHAR(20) NOT NULL, 
	audience_size INTEGER NOT NULL, 
	scheduled_for TIMESTAMP WITHOUT TIME ZONE, 
	created_by VARCHAR(36), 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(created_by) REFERENCES users (id)
);

CREATE TABLE events (
	id VARCHAR(36) NOT NULL, 
	organizer_id VARCHAR(36), 
	created_by_user_id VARCHAR(36), 
	title VARCHAR(255) NOT NULL, 
	description TEXT, 
	venue VARCHAR(255) NOT NULL, 
	event_date TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	organizer_phone VARCHAR(15) NOT NULL, 
	total_capacity INTEGER NOT NULL, 
	tickets_sold INTEGER NOT NULL, 
	contract_address VARCHAR(42), 
	status eventstatus NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	category VARCHAR(50), 
	description_html TEXT, 
	image_data BYTEA, 
	image_mime VARCHAR(30), 
	image_updated_at TIMESTAMP WITHOUT TIME ZONE, 
	ends_at TIMESTAMP WITHOUT TIME ZONE, 
	artists JSON, 
	gates JSON, 
	resale_enabled BOOLEAN DEFAULT '1' NOT NULL, 
	resale_window_open_days INTEGER DEFAULT '0' NOT NULL, 
	resale_window_close_hours INTEGER DEFAULT '2' NOT NULL, 
	review_state VARCHAR(20), 
	review_note TEXT, 
	submitted_for_review_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(organizer_id) REFERENCES organizers (id), 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id)
);

CREATE TABLE feature_flags (
	key VARCHAR(50) NOT NULL, 
	enabled BOOLEAN NOT NULL, 
	rollout_percent INTEGER NOT NULL, 
	updated_by VARCHAR(36), 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (key), 
	FOREIGN KEY(updated_by) REFERENCES users (id)
);

CREATE TABLE fee_schedule (
	id VARCHAR(36) NOT NULL, 
	platform_fee_percent FLOAT NOT NULL, 
	scanning_fee_kes FLOAT NOT NULL, 
	min_payout_kes FLOAT NOT NULL, 
	seller_escrow_days INTEGER NOT NULL, 
	organiser_escrow_days INTEGER NOT NULL, 
	effective_from TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	changed_by VARCHAR(36), 
	PRIMARY KEY (id), 
	FOREIGN KEY(changed_by) REFERENCES users (id)
);

CREATE INDEX ix_fee_schedule_effective_from ON fee_schedule (effective_from);

CREATE TABLE notifications (
	id VARCHAR(36) NOT NULL, 
	recipient_id VARCHAR(36) NOT NULL, 
	notification_type VARCHAR(50) NOT NULL, 
	channel VARCHAR(20) NOT NULL, 
	reference VARCHAR(64), 
	status notificationstatus NOT NULL, 
	sent_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(recipient_id) REFERENCES users (id)
);

CREATE INDEX ix_notifications_reference ON notifications (reference);

CREATE TABLE organizer_members (
	id VARCHAR(36) NOT NULL, 
	organizer_id VARCHAR(36) NOT NULL, 
	account_id VARCHAR(36) NOT NULL, 
	role organizerrole NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(organizer_id) REFERENCES organizers (id), 
	FOREIGN KEY(account_id) REFERENCES users (id)
);

CREATE TABLE event_tiers (
	id VARCHAR(36) NOT NULL, 
	event_id VARCHAR(36) NOT NULL, 
	tier_name VARCHAR(100) NOT NULL, 
	price_kes FLOAT NOT NULL, 
	capacity INTEGER NOT NULL, 
	tickets_sold INTEGER NOT NULL, 
	resale_floor_price_kes FLOAT NOT NULL, 
	resale_ceiling_price_kes FLOAT NOT NULL, 
	organizer_royalty_percent FLOAT NOT NULL, 
	status tierstatus NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	description TEXT, 
	per_order_max INTEGER, 
	visibility VARCHAR(20) DEFAULT 'public' NOT NULL, 
	sales_start TIMESTAMP WITHOUT TIME ZONE, 
	sales_end TIMESTAMP WITHOUT TIME ZONE, 
	sort_order INTEGER DEFAULT '0' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES events (id)
);

CREATE TABLE gate_scanners (
	id VARCHAR(36) NOT NULL, 
	event_id VARCHAR(36) NOT NULL, 
	organizer_id VARCHAR(36), 
	account_id VARCHAR(36), 
	gate_name VARCHAR(100) NOT NULL, 
	label VARCHAR(100), 
	device_id VARCHAR(100), 
	enrollment_code VARCHAR(20), 
	enrollment_code_expires_at TIMESTAMP WITHOUT TIME ZONE, 
	device_token_hash VARCHAR(64), 
	last_sync_at TIMESTAMP WITHOUT TIME ZONE, 
	status gatescannerstatus NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES events (id), 
	FOREIGN KEY(organizer_id) REFERENCES organizers (id), 
	FOREIGN KEY(account_id) REFERENCES users (id), 
	UNIQUE (device_id)
);

CREATE INDEX ix_gate_scanners_device_token_hash ON gate_scanners (device_token_hash);
CREATE INDEX ix_gate_scanners_enrollment_code ON gate_scanners (enrollment_code);

CREATE TABLE price_caps (
	id VARCHAR(36) NOT NULL, 
	event_id VARCHAR(36) NOT NULL, 
	tier_id VARCHAR(36) NOT NULL, 
	cap_price_kes FLOAT NOT NULL, 
	floor_price_kes FLOAT NOT NULL, 
	change_type pricecapchangetype NOT NULL, 
	effective_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES events (id), 
	FOREIGN KEY(tier_id) REFERENCES event_tiers (id)
);

CREATE TABLE tickets (
	id VARCHAR(36) NOT NULL, 
	event_id VARCHAR(36) NOT NULL, 
	tier_id VARCHAR(36), 
	owner_id VARCHAR(36) NOT NULL, 
	gate_scanner_id VARCHAR(36), 
	group_payment_id VARCHAR(36), 
	status ticketstatus NOT NULL, 
	nft_token_id INTEGER, 
	nft_tx_hash VARCHAR(66), 
	nft_contract_address VARCHAR(42), 
	onchain_face_kes INTEGER, 
	onchain_floor_kes INTEGER, 
	onchain_cap_kes INTEGER, 
	used_tx_hash VARCHAR(66), 
	seat_number VARCHAR(20), 
	is_complimentary BOOLEAN DEFAULT '0' NOT NULL, 
	complimentary_note VARCHAR(255), 
	recipient_name VARCHAR(100), 
	purchased_at TIMESTAMP WITHOUT TIME ZONE, 
	used_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES events (id), 
	FOREIGN KEY(tier_id) REFERENCES event_tiers (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id), 
	FOREIGN KEY(gate_scanner_id) REFERENCES gate_scanners (id)
);

CREATE TABLE attendances (
	id VARCHAR(36) NOT NULL, 
	ticket_id VARCHAR(36), 
	scanned_ref VARCHAR(64), 
	event_id VARCHAR(36) NOT NULL, 
	scanner_id VARCHAR(36), 
	scan_time TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	status attendancestatus NOT NULL, 
	denial_reason VARCHAR(30), 
	PRIMARY KEY (id), 
	FOREIGN KEY(ticket_id) REFERENCES tickets (id), 
	FOREIGN KEY(event_id) REFERENCES events (id), 
	FOREIGN KEY(scanner_id) REFERENCES gate_scanners (id)
);

CREATE TABLE barcodes (
	id VARCHAR(36) NOT NULL, 
	ticket_id VARCHAR(36) NOT NULL, 
	event_id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	token TEXT NOT NULL, 
	token_version INTEGER NOT NULL, 
	status barcodestatus NOT NULL, 
	expires_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(ticket_id) REFERENCES tickets (id), 
	FOREIGN KEY(event_id) REFERENCES events (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
);

CREATE TABLE payments (
	id VARCHAR(36) NOT NULL, 
	ticket_id VARCHAR(36) NOT NULL, 
	tier_id VARCHAR(36), 
	user_id VARCHAR(36) NOT NULL, 
	quantity INTEGER NOT NULL, 
	amount_kes FLOAT NOT NULL, 
	status paymentstatus NOT NULL, 
	merchant_request_id VARCHAR(100), 
	checkout_request_id VARCHAR(100), 
	mpesa_receipt_number VARCHAR(50), 
	phone_number VARCHAR(15) NOT NULL, 
	method VARCHAR(10) DEFAULT 'mpesa' NOT NULL, 
	provider_reference VARCHAR(100), 
	provider_transaction_id VARCHAR(50), 
	card_brand VARCHAR(20), 
	card_last4 VARCHAR(4), 
	initiated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	confirmed_at TIMESTAMP WITHOUT TIME ZONE, 
	failure_reason VARCHAR(255), 
	PRIMARY KEY (id), 
	FOREIGN KEY(ticket_id) REFERENCES tickets (id), 
	FOREIGN KEY(tier_id) REFERENCES event_tiers (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE UNIQUE INDEX ix_payments_checkout_request_id ON payments (checkout_request_id);
CREATE INDEX ix_payments_merchant_request_id ON payments (merchant_request_id);
CREATE UNIQUE INDEX ix_payments_provider_reference ON payments (provider_reference);

CREATE TABLE transfers (
	id VARCHAR(36) NOT NULL, 
	ticket_id VARCHAR(36) NOT NULL, 
	event_id VARCHAR(36) NOT NULL, 
	seller_id VARCHAR(36) NOT NULL, 
	buyer_id VARCHAR(36), 
	payment_id VARCHAR(36), 
	transfer_type transfertype NOT NULL, 
	status transferstatus NOT NULL, 
	asking_price_kes FLOAT NOT NULL, 
	transfer_price_kes FLOAT, 
	organizer_royalty_kes FLOAT, 
	platform_fee_kes FLOAT, 
	seller_payout_kes FLOAT, 
	listing_tx_hash VARCHAR(66), 
	settlement_tx_hash VARCHAR(66), 
	views INTEGER NOT NULL, 
	pause_reason VARCHAR(255), 
	transferred_at TIMESTAMP WITHOUT TIME ZONE, 
	cancelled_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(ticket_id) REFERENCES tickets (id), 
	FOREIGN KEY(event_id) REFERENCES events (id), 
	FOREIGN KEY(seller_id) REFERENCES users (id), 
	FOREIGN KEY(buyer_id) REFERENCES users (id), 
	FOREIGN KEY(payment_id) REFERENCES payments (id)
);

CREATE TABLE wallet_transactions (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	transfer_id VARCHAR(36), 
	type wallettransactiontype NOT NULL, 
	description VARCHAR(255) NOT NULL, 
	amount_kes FLOAT NOT NULL, 
	status wallettransactionstatus NOT NULL, 
	available_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	FOREIGN KEY(transfer_id) REFERENCES transfers (id)
);

CREATE TABLE payouts (
	id VARCHAR(36) NOT NULL, 
	recipient_type VARCHAR(10) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	organizer_id VARCHAR(36), 
	wallet_transaction_id VARCHAR(36), 
	channel VARCHAR(10) NOT NULL, 
	destination VARCHAR(20) NOT NULL, 
	account_reference VARCHAR(20), 
	destination_label VARCHAR(100), 
	amount_kes FLOAT NOT NULL, 
	charge_kes FLOAT NOT NULL, 
	net_kes FLOAT NOT NULL, 
	status payoutstatus NOT NULL, 
	reviewed_by VARCHAR(36), 
	reviewed_at TIMESTAMP WITHOUT TIME ZONE, 
	review_note TEXT, 
	originator_conversation_id VARCHAR(64), 
	conversation_id VARCHAR(64), 
	mpesa_receipt VARCHAR(20), 
	recipient_name VARCHAR(255), 
	result_code VARCHAR(20), 
	result_desc TEXT, 
	result_payload JSON, 
	manual BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	sent_at TIMESTAMP WITHOUT TIME ZONE, 
	completed_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	FOREIGN KEY(organizer_id) REFERENCES organizers (id), 
	FOREIGN KEY(wallet_transaction_id) REFERENCES wallet_transactions (id), 
	FOREIGN KEY(reviewed_by) REFERENCES users (id)
);

CREATE INDEX ix_payouts_conversation_id ON payouts (conversation_id);
CREATE INDEX ix_payouts_organizer_id ON payouts (organizer_id);
CREATE INDEX ix_payouts_originator_conversation_id ON payouts (originator_conversation_id);

ALTER TABLE tickets ADD CONSTRAINT fk_tickets_group_payment_id FOREIGN KEY(group_payment_id) REFERENCES payments (id);
