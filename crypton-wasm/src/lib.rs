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
pub fn sign_and_encrypt(
    private_key: String,
    public_key: String,
    sub_passphrase: &str,
    plain: Vec<u8>,
) -> Result<JsValue, JsValue> {
    let private = get_private_keys(private_key)?;
    let public = get_public_keys(public_key)?;
    let armored = private
        .sign_and_encrypt(sub_passphrase, &public, plain)
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
