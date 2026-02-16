use base64::engine::general_purpose::STANDARD;
use base64::{Engine, engine::general_purpose::URL_SAFE};
use wasm_bindgen::prelude::*;

mod keys;

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("key generation error: {0}")]
    KeyGenerationError(String),
    #[error("key format error: {0}")]
    KeyFormatError(String),
    #[error("encryption error: {0}")]
    EncryptionError(String),
    #[error("decryption error: {0}")]
    DecryptionError(String),
    #[error("signing error: {0}")]
    SigningError(String),
    #[error("verification error: {0}")]
    VerificationError(String),
    #[error("invalid payload error: {0}")]
    InvalidPayload(String),
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub struct PrivateKeysArmor {}

#[derive(serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ResultData {
    String { data: String },
    Base64 { data: String },
}

#[derive(serde::Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum ReturnValue {
    Ok { value: Vec<ResultData> },
    Error { message: String },
}
impl ReturnValue {
    pub fn to_value(&self) -> wasm_bindgen::JsValue {
        serde_wasm_bindgen::to_value(self)
            .map_err(|e| gloo::console::log!(e.to_string()))
            .unwrap()
    }
}

#[wasm_bindgen]
pub fn generate_private_keys(
    user_id: String,
    main_passphrase: String,
    sub_passphrase: String,
) -> wasm_bindgen::JsValue {
    let (keys, _subkeys) = match keys::generate_keys(user_id, main_passphrase, sub_passphrase) {
        Ok(v) => v,
        Err(e) => {
            return ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value();
        }
    };
    ReturnValue::Ok {
        value: vec![ResultData::String { data: keys }],
    }
    .to_value()
}

fn get_private_keys(keys: String) -> Result<keys::PrivateKeys, JsValue> {
    let keys = keys::PrivateKeys::try_from(keys.as_str()).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(keys)
}
fn get_public_keys(keys: String) -> Result<keys::PublicKeys, JsValue> {
    let keys = keys::PublicKeys::try_from(keys.as_str()).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(keys)
}

#[wasm_bindgen]
pub fn export_public_keys(keys: String) -> Result<JsValue, JsValue> {
    let keys = get_private_keys(keys)?;
    let pub_key = keys.public_keys();
    Ok(ReturnValue::Ok {
        value: vec![ResultData::String { data: pub_key }],
    }
    .to_value())
}

#[wasm_bindgen]
pub fn get_signing_sub_key_id(public_keys: String) -> Result<JsValue, JsValue> {
    let keys = get_public_keys(public_keys)?;
    Ok(ReturnValue::Ok {
        value: vec![ResultData::String {
            data: keys.get_signing_sub_key_id(),
        }],
    }
    .to_value())
}
#[wasm_bindgen]
pub fn get_pub_key_user_ids(public_keys: String) -> Result<JsValue, JsValue> {
    let keys = get_public_keys(public_keys)?;
    let value = keys
        .get_user_ids()
        .into_iter()
        .map(|data| ResultData::String { data })
        .collect();
    Ok(ReturnValue::Ok { value }.to_value())
}

#[wasm_bindgen]
pub fn get_private_key_user_ids(private_keys: String) -> Result<JsValue, JsValue> {
    let keys = get_private_keys(private_keys)?;
    let value = keys
        .get_user_ids()
        .into_iter()
        .map(|data| ResultData::String { data })
        .collect();
    Ok(ReturnValue::Ok { value }.to_value())
}

#[wasm_bindgen]
pub fn sign_encrypt_sign(
    private_key: String,
    public_keys: Vec<String>,
    sub_passphrase: &str,
    plain: Vec<u8>,
) -> Result<JsValue, JsValue> {
    let private = get_private_keys(private_key)?;
    let recipients: Vec<keys::PublicKeys> = public_keys
        .iter()
        .map(|k| keys::PublicKeys::try_from(k.as_str()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| {
            ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value()
        })?;
    let recipient_refs: Vec<&keys::PublicKeys> = recipients.iter().collect();
    let armored = private
        .sign_encrypt_sign(sub_passphrase, &recipient_refs, plain)
        .map_err(|e| {
            ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value()
        })?;
    Ok(ReturnValue::Ok {
        value: vec![ResultData::String { data: armored }],
    }
    .to_value())
}
/// `sign_encrypt_sign` のバイナリ出力版。
/// 返り値: [Base64(raw_pgp_bytes)]
#[wasm_bindgen]
pub fn sign_encrypt_sign_bin(
    private_key: String,
    public_keys: Vec<String>,
    sub_passphrase: &str,
    plain: Vec<u8>,
) -> Result<JsValue, JsValue> {
    let private = get_private_keys(private_key)?;
    let recipients: Vec<keys::PublicKeys> = public_keys
        .iter()
        .map(|k| keys::PublicKeys::try_from(k.as_str()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| {
            ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value()
        })?;
    let recipient_refs: Vec<&keys::PublicKeys> = recipients.iter().collect();
    let raw_bytes = private
        .sign_encrypt_sign_bin(sub_passphrase, &recipient_refs, plain)
        .map_err(|e| {
            ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value()
        })?;
    Ok(ReturnValue::Ok {
        value: vec![ResultData::Base64 {
            data: STANDARD.encode(&raw_bytes),
        }],
    }
    .to_value())
}

#[wasm_bindgen]
pub fn decrypt(private_key: String, sub_passphrase: &str, data: &str) -> Result<JsValue, JsValue> {
    let private = get_private_keys(private_key)?;
    let (data, signature, key_ids) = private.decrypt(sub_passphrase, data).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    let mut result = Vec::with_capacity(1 + key_ids.len());
    result.push(ResultData::Base64 {
        data: URL_SAFE.encode(&data),
    });
    if let Some(data) = signature {
        result.push(ResultData::String { data });
        for key_id in key_ids {
            result.push(ResultData::String { data: key_id });
        }
    }
    Ok(ReturnValue::Ok { value: result }.to_value())
}

#[wasm_bindgen]
pub fn sign(keys: String, sub_passphrase: &str, data: Vec<u8>) -> Result<JsValue, JsValue> {
    let keys = get_private_keys(keys)?;
    let data = keys.sign(sub_passphrase, data).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(ReturnValue::Ok {
        value: vec![ResultData::Base64 {
            data: URL_SAFE.encode(&data),
        }],
    }
    .to_value())
}
/// 署名のみ（暗号化なし）を raw PGP バイト列で返す。
/// 返り値: [Base64(raw_pgp_bytes)]
#[wasm_bindgen]
pub fn sign_bytes(keys: String, sub_passphrase: &str, data: Vec<u8>) -> Result<JsValue, JsValue> {
    let keys = get_private_keys(keys)?;
    let raw_bytes = keys.sign_bytes(sub_passphrase, data).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(ReturnValue::Ok {
        value: vec![ResultData::Base64 {
            data: STANDARD.encode(&raw_bytes),
        }],
    }
    .to_value())
}

#[wasm_bindgen]
pub fn verify(public_key: String, armored: &str) -> Result<JsValue, JsValue> {
    let keys = get_public_keys(public_key)?;
    keys.verify(armored).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(ReturnValue::Ok { value: Vec::new() }.to_value())
}
#[wasm_bindgen]
pub fn validate_passphrases(
    private_key: String,
    main_passphrase: &str,
    sub_passphrase: &str,
) -> Result<JsValue, JsValue> {
    let keys = get_private_keys(private_key)?;
    keys.validate_main_passphrase(main_passphrase)
        .map_err(|e| {
            ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value()
        })?;
    keys.validate_sub_passphrase(sub_passphrase).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(ReturnValue::Ok { value: Vec::new() }.to_value())
}

#[wasm_bindgen]
pub fn verify_detached_signature(
    public_key: String,
    armored: &str,
    data: Vec<u8>,
) -> Result<JsValue, JsValue> {
    let keys = get_public_keys(public_key)?;
    keys.verify_detached_signature(armored, &data)
        .map_err(|e| {
            ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value()
        })?;
    Ok(ReturnValue::Ok { value: Vec::new() }.to_value())
}

/// 外側署名を検証してペイロード（inner encrypted bytes）を取り出す。
/// 返り値: [Base64(inner_bytes), String(outer_key_id)]
#[wasm_bindgen]
pub fn unwrap_outer(public_key: String, outer_armored: &str) -> Result<JsValue, JsValue> {
    let outer_key_id = crypton_common::keys::extract_issuer_key_id(outer_armored).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    let common_pk =
        crypton_common::keys::PublicKeys::try_from(public_key.as_str()).map_err(|e| {
            ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value()
        })?;
    let inner_bytes = common_pk.verify_and_extract(outer_armored).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(ReturnValue::Ok {
        value: vec![
            ResultData::Base64 {
                data: STANDARD.encode(&inner_bytes),
            },
            ResultData::String { data: outer_key_id },
        ],
    }
    .to_value())
}

/// raw PGP bytes を復号する（decrypt と同じ返り値形式）。
#[wasm_bindgen]
pub fn decrypt_bytes(
    private_key: String,
    sub_passphrase: &str,
    data: Vec<u8>,
) -> Result<JsValue, JsValue> {
    let private = get_private_keys(private_key)?;
    let (data, signature, key_ids) =
        private
            .decrypt_from_bytes(sub_passphrase, &data)
            .map_err(|e| {
                ReturnValue::Error {
                    message: e.to_string(),
                }
                .to_value()
            })?;
    let mut result = Vec::with_capacity(1 + key_ids.len());
    result.push(ResultData::Base64 {
        data: URL_SAFE.encode(&data),
    });
    if let Some(data) = signature {
        result.push(ResultData::String { data });
        for key_id in key_ids {
            result.push(ResultData::String { data: key_id });
        }
    }
    Ok(ReturnValue::Ok { value: result }.to_value())
}

/// raw PGP バイト列から署名者の鍵IDを抽出する。
/// 返り値: [String(key_id)]
#[wasm_bindgen]
pub fn extract_key_id_bytes(data: Vec<u8>) -> Result<JsValue, JsValue> {
    let key_id = crypton_common::keys::extract_issuer_key_id_from_bytes(&data).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(ReturnValue::Ok {
        value: vec![ResultData::String { data: key_id }],
    }
    .to_value())
}

/// raw PGP バイト列の外側署名を検証してペイロード（inner encrypted bytes）を取り出す。
/// 返り値: [Base64(inner_bytes), String(outer_key_id)]
#[wasm_bindgen]
pub fn unwrap_outer_bytes(public_key: String, data: Vec<u8>) -> Result<JsValue, JsValue> {
    let outer_key_id =
        crypton_common::keys::extract_issuer_key_id_from_bytes(&data).map_err(|e| {
            ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value()
        })?;
    let common_pk =
        crypton_common::keys::PublicKeys::try_from(public_key.as_str()).map_err(|e| {
            ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value()
        })?;
    let inner_bytes = common_pk
        .verify_and_extract_from_bytes(&data)
        .map_err(|e| {
            ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value()
        })?;
    Ok(ReturnValue::Ok {
        value: vec![
            ResultData::Base64 {
                data: STANDARD.encode(&inner_bytes),
            },
            ResultData::String { data: outer_key_id },
        ],
    }
    .to_value())
}

/// 署名を検証し、ペイロードをUTF-8文字列として取り出す。
/// 返り値: [String(plaintext)]
#[wasm_bindgen]
pub fn verify_extract_string(public_key: String, armored: &str) -> Result<JsValue, JsValue> {
    let common_pk =
        crypton_common::keys::PublicKeys::try_from(public_key.as_str()).map_err(|e| {
            ReturnValue::Error {
                message: e.to_string(),
            }
            .to_value()
        })?;
    let bytes = common_pk.verify_and_extract(armored).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    let plaintext = String::from_utf8(bytes).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(ReturnValue::Ok {
        value: vec![ResultData::String { data: plaintext }],
    }
    .to_value())
}

/// armored PGP メッセージから署名者の鍵IDを抽出する。
/// 返り値: [String(key_id)]
#[wasm_bindgen]
pub fn extract_key_id(armored: &str) -> Result<JsValue, JsValue> {
    let key_id = crypton_common::keys::extract_issuer_key_id(armored).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(ReturnValue::Ok {
        value: vec![ResultData::String { data: key_id }],
    }
    .to_value())
}
