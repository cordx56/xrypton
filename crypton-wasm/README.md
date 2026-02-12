# crypton-wasm

PGP暗号処理をブラウザで利用するためのWASM実装。Web Workerから呼び出される。

## ビルド

```bash
wasm-pack build --target web
```

ビルド成果物は `pkg/` に出力される。

## 提供関数

### 鍵生成

- `generate(user_id, main_passphrase, sub_passphrase)` — PGP鍵ペア（主鍵 + 署名サブキー + 暗号化サブキー）を生成。主パスフレーズで主鍵を保護し、サブパスフレーズでサブキーを保護する。

### 復号

- `decrypt(private_keys, sub_passphrase, armored_message)` — PGP暗号化メッセージを復号。署名検証も同時に行う。

### 署名

- `sign(private_keys, sub_passphrase, data)` — データにPGP署名を付与。API認証に使用。

## 鍵の構造

```
主鍵 (RSA 4096bit, main_passphrase で保護)
├── 署名サブキー (RSA 4096bit, sub_passphrase で保護)
└── 暗号化サブキー (RSA 4096bit, sub_passphrase で保護)
```

- `main_passphrase`: 鍵エクスポート時の保護。通常の操作では不要
- `sub_passphrase`: 署名・復号の都度必要。ブラウザに保存可能（オプション）

## 依存

- `pgp` 0.18.0 (wasm feature)
- `wasm-bindgen` 0.2
- `serde` / `serde-wasm-bindgen`
