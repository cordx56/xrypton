use base64::{Engine, engine::general_purpose::URL_SAFE};
use gloo::storage::Storage;
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
    #[error("invalid payload error: {0}")]
    InvalidPayload(String),
    #[error("web storage error: {0}")]
    WebStorageError(String),
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub struct PrivateKeysArmor {}

#[derive(serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ResultData {
    String(String),
    Base64(String),
}

#[derive(serde::Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum ReturnValue {
    Ok { value: Option<ResultData> },
    Error { message: String },
}
impl ReturnValue {
    pub fn to_value(&self) -> wasm_bindgen::JsValue {
        serde_wasm_bindgen::to_value(self).unwrap()
    }
}

#[wasm_bindgen]
pub fn generate_and_save_private_keys(
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
    if let Err(e) = gloo::storage::LocalStorage::set("private_keys", keys) {
        return ReturnValue::Error {
            message: Error::WebStorageError(e.to_string()).to_string(),
        }
        .to_value();
    }
    ReturnValue::Ok { value: None }.to_value()
}

fn get_keys() -> Result<keys::PrivateKeys, JsValue> {
    let keys: String = gloo::storage::LocalStorage::get("private_keys").map_err(|e| {
        ReturnValue::Error {
            message: Error::WebStorageError(e.to_string()).to_string(),
        }
        .to_value()
    })?;
    let keys = keys::PrivateKeys::try_from(keys.as_str()).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(keys)
}

#[wasm_bindgen]
pub fn export_public_keys() -> Result<JsValue, JsValue> {
    let keys = get_keys()?;
    let pub_key = keys.public_keys();
    Ok(ReturnValue::Ok {
        value: Some(ResultData::String(pub_key)),
    }
    .to_value())
}

#[wasm_bindgen]
pub fn encrypt(public_key: String, plain: Vec<u8>) -> JsValue {
    match keys::encrypt(&public_key, plain) {
        Ok(v) => ReturnValue::Ok {
            value: Some(ResultData::String(v)),
        }
        .to_value(),
        Err(e) => ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value(),
    }
}
#[wasm_bindgen]
pub fn decrypt(sub_passphrase: &str, data: &str) -> Result<JsValue, JsValue> {
    let keys = get_keys()?;
    let data = keys.decrypt(sub_passphrase, data).map_err(|e| {
        ReturnValue::Error {
            message: e.to_string(),
        }
        .to_value()
    })?;
    Ok(ReturnValue::Ok {
        value: Some(ResultData::Base64(URL_SAFE.encode(&data))),
    }
    .to_value())
}
