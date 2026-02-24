use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use pgp::composed::{ArmorOptions, Message, MessageBuilder};
use pgp::crypto::sym::SymmetricKeyAlgorithm;
use pgp::types::{Password, StringToKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};

use crate::Error;

const VERSION: u8 = 1;
const ALG: &str = "xrypton_backup_v1";
const ARGON2_T_COST: u8 = 3;
const ARGON2_P_COST: u8 = 1;
const ARGON2_M_ENC: u8 = 16;

#[derive(Debug, Deserialize)]
pub struct BackupPayload {
    pub subpassphrase: String,
    pub secret_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupEnvelopeV1 {
    pub version: u8,
    pub alg: String,
    pub webauthn_credential_id_b64: String,
    pub inner_armored: String,
}

fn parse_payload(payload_json: &str) -> Result<BackupPayload, Error> {
    let payload: BackupPayload =
        serde_json::from_str(payload_json).map_err(|e| Error::InvalidPayload(e.to_string()))?;
    if payload.subpassphrase.is_empty() {
        return Err(Error::InvalidPayload("subpassphrase is required".into()));
    }
    if payload.secret_key.is_empty() {
        return Err(Error::InvalidPayload("secret_key is required".into()));
    }
    Ok(payload)
}

fn pgp_encrypt_with_password(plain: Vec<u8>, password: &str) -> Result<String, Error> {
    let mut builder =
        MessageBuilder::from_bytes("", plain).seipd_v1(OsRng, SymmetricKeyAlgorithm::AES256);
    builder
        .encrypt_with_password(
            StringToKey::new_argon2(OsRng, ARGON2_T_COST, ARGON2_P_COST, ARGON2_M_ENC),
            &Password::from(password),
        )
        .map_err(|e| Error::EncryptionError(e.to_string()))?;

    builder
        .to_armored_string(OsRng, ArmorOptions::default())
        .map_err(|e| Error::EncryptionError(e.to_string()))
}

fn pgp_decrypt_with_password(armored: &str, password: &str) -> Result<Vec<u8>, Error> {
    let (msg, _) =
        Message::from_string(armored).map_err(|e| Error::DecryptionError(e.to_string()))?;
    let mut msg = msg
        .decrypt_with_password(&Password::from(password))
        .map_err(|e| Error::DecryptionError(e.to_string()))?;
    msg.as_data_vec()
        .map_err(|e| Error::DecryptionError(e.to_string()))
}

fn build_prf_password(prf_output_b64: &str) -> String {
    format!("xrypton-prf-v1:{prf_output_b64}")
}

pub fn backup_encrypt(
    payload_json: &str,
    main_passphrase: &str,
    prf_output_b64: &str,
    credential_id_b64: &str,
) -> Result<String, Error> {
    parse_payload(payload_json)?;
    if credential_id_b64.is_empty() {
        return Err(Error::InvalidPayload("credential id is required".into()));
    }
    let prf_output = STANDARD
        .decode(prf_output_b64)
        .map_err(|e| Error::InvalidPayload(format!("invalid prf output: {e}")))?;
    if prf_output.is_empty() {
        return Err(Error::InvalidPayload("prf output is empty".into()));
    }

    let prf_password = build_prf_password(prf_output_b64);
    let inner_armored = pgp_encrypt_with_password(payload_json.as_bytes().to_vec(), &prf_password)?;

    let envelope = BackupEnvelopeV1 {
        version: VERSION,
        alg: ALG.to_string(),
        webauthn_credential_id_b64: credential_id_b64.to_string(),
        inner_armored,
    };

    let outer_plain =
        serde_json::to_vec(&envelope).map_err(|e| Error::EncryptionError(e.to_string()))?;
    pgp_encrypt_with_password(outer_plain, main_passphrase)
}

pub fn backup_decrypt(
    armored: &str,
    main_passphrase: &str,
    prf_output_b64: &str,
    credential_id_b64: &str,
) -> Result<(String, String), Error> {
    let prf_output = STANDARD
        .decode(prf_output_b64)
        .map_err(|e| Error::InvalidPayload(format!("invalid prf output: {e}")))?;
    if prf_output.is_empty() {
        return Err(Error::InvalidPayload("prf output is empty".into()));
    }

    let outer_plain = pgp_decrypt_with_password(armored, main_passphrase)?;
    let envelope: BackupEnvelopeV1 =
        serde_json::from_slice(&outer_plain).map_err(|e| Error::DecryptionError(e.to_string()))?;

    if envelope.version != VERSION {
        return Err(Error::DecryptionError("unsupported backup version".into()));
    }
    if envelope.alg != ALG {
        return Err(Error::DecryptionError(
            "unsupported backup algorithm".into(),
        ));
    }
    if envelope.webauthn_credential_id_b64 != credential_id_b64 {
        return Err(Error::DecryptionError("credential mismatch".into()));
    }

    let prf_password = build_prf_password(prf_output_b64);
    let plain = pgp_decrypt_with_password(&envelope.inner_armored, &prf_password)?;
    let payload_json =
        String::from_utf8(plain).map_err(|e| Error::DecryptionError(e.to_string()))?;

    parse_payload(&payload_json)?;
    Ok((payload_json, envelope.webauthn_credential_id_b64))
}
