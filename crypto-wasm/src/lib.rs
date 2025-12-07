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
pub enum Keys {
    Private { signing: String, encryption: String },
    Public {},
}

#[derive(serde::Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum ReturnValue {
    Ok { value: Option<String> },
    Error { message: String },
}
impl ToString for ReturnValue {
    fn to_string(&self) -> String {
        serde_json::to_string(self).unwrap()
    }
}

#[wasm_bindgen]
pub fn generate_and_save_private_keys(passphrase: String) -> String {
    let signing =
        match keys::generate_private_key(passphrase.clone(), keys::PrivateKeyType::Signing) {
            Ok(v) => v,
            Err(e) => {
                return ReturnValue::Error {
                    message: e.to_string(),
                }
                .to_string();
            }
        };
    let encryption = match keys::generate_private_key(passphrase, keys::PrivateKeyType::Encryption)
    {
        Ok(v) => v,
        Err(e) => {
            return ReturnValue::Error {
                message: e.to_string(),
            }
            .to_string();
        }
    };
    let keys = Keys::Private {
        signing,
        encryption,
    };
    match gloo::storage::LocalStorage::set("private_keys", serde_json::to_string(&keys).unwrap()) {
        Ok(_) => ReturnValue::Ok { value: None }.to_string(),
        Err(e) => ReturnValue::Error {
            message: Error::WebStorageError(e.to_string()).to_string(),
        }
        .to_string(),
    }
}

/*
#[wasm_bindgen]
pub fn encrypt(passphrase: String) -> String {
    let keys: String = match gloo::storage::LocalStorage::get("private_keys") {
        Ok(v) => v,
        Err(e) => {
            return ReturnValue::Error {
                message: Error::WebStorageError(e.to_string()).to_string(),
            }
            .to_string();
        }
    };
    let encryption = match serde_json::from_str(&keys) {
        Ok(Keys::Private { encryption, .. }) => encryption,
        _ => {
            return ReturnValue::Error {
                message: Error::WebStorageError("invalid key format".to_string()).to_string(),
            }
            .to_string();
        }
    };
}
*/
