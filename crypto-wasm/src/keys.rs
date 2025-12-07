use crate::*;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use pgp::{composed::*, ser::Serialize, types::*};
use rand::rngs::OsRng;

#[derive(Debug)]
pub enum PrivateKeyType {
    Signing,
    Encryption,
}

pub fn generate_private_key(passphrase: String, key_type: PrivateKeyType) -> Result<String, Error> {
    let params = SecretKeyParamsBuilder::default()
        .version(KeyVersion::V6)
        .key_type(if matches!(key_type, PrivateKeyType::Signing) {
            KeyType::Ed25519
        } else {
            KeyType::X25519
        })
        .can_sign(if matches!(key_type, PrivateKeyType::Signing) {
            true
        } else {
            false
        })
        .can_encrypt(if matches!(key_type, PrivateKeyType::Encryption) {
            true
        } else {
            false
        })
        .can_authenticate(false)
        .passphrase(Some(passphrase.clone()))
        .build()
        .map_err(|e| Error::KeyGenerationError(e.to_string()))?;
    let key = params
        .generate(OsRng::default())
        .map_err(|e| Error::KeyGenerationError(e.to_string()))?;
    let signed = key
        .sign(OsRng::default(), &passphrase.into())
        .map_err(|e| Error::KeyGenerationError(e.to_string()))?;
    signed
        .to_armored_string(ArmorOptions::default())
        .map_err(|e| Error::KeyGenerationError(e.to_string()))
}

pub fn get_public_key(secret_key: &str) -> Result<String, Error> {
    let (key, _) = SignedSecretKey::from_string(secret_key)
        .map_err(|e| Error::KeyFormatError(e.to_string()))?;
    key.signed_public_key()
        .to_armored_string(ArmorOptions::default())
        .map_err(|e| Error::KeyGenerationError(e.to_string()))
}

pub fn encrypt(public_key: &str, plain: &[u8]) -> Result<String, Error> {
    let (key, _) = SignedPublicKey::from_string(public_key)
        .map_err(|e| Error::KeyFormatError(e.to_string()))?;
    let encrypted = key
        .encrypt(OsRng::default(), plain, EskType::V6)
        .map_err(|e| Error::EncryptionError(e.to_string()))?;
    let mut data = Vec::with_capacity(encrypted.write_len());
    encrypted
        .to_writer(&mut data)
        .map_err(|e| Error::EncryptionError(e.to_string()))?;
    Ok(URL_SAFE_NO_PAD.encode(&data))
}

pub fn decrypt(secret_key: &str, passphrase: &str, encrypted: &str) -> Result<Vec<u8>, Error> {
    let (key, _) = SignedSecretKey::from_string(secret_key)
        .map_err(|e| Error::DecryptionError(e.to_string()))?;
    let (message, _) =
        Message::from_string(encrypted).map_err(|e| Error::InvalidPayload(e.to_string()))?;
    let mut decrypted = message
        .decrypt(&Password::from(passphrase), &key)
        .map_err(|e| Error::DecryptionError(e.to_string()))?;
    decrypted
        .as_data_vec()
        .map_err(|e| Error::DecryptionError(e.to_string()))
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn generate_encrypt_and_decrypt() {
        let pass = "passphrase";
        let secret_key = generate_private_key(pass.to_string(), PrivateKeyType::Encryption).unwrap();

        let public_key = get_public_key(&secret_key).unwrap();
        let plain = b"Hello, world!";
        let encrypted = encrypt(&public_key, plain).unwrap();

        let decrypted = decrypt(&secret_key, &pass, &encrypted).unwrap();

        assert_eq!(&decrypted, plain);
    }
}
