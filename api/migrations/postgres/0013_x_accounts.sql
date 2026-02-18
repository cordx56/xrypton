CREATE TABLE x_accounts (
    user_id TEXT NOT NULL,
    x_handle TEXT NOT NULL,
    x_author_url TEXT NOT NULL,
    x_post_url TEXT NOT NULL,
    proof_json TEXT NOT NULL,
    signature TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, x_handle),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_x_accounts_user ON x_accounts(user_id);
