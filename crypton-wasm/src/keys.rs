use crate::*;
use pgp::{
    composed::*,
    crypto,
    types::{KeyDetails, *},
};
use rand::rngs::OsRng;

#[derive(Debug)]
pub struct PrivateKeys {
    keys: SignedSecretKey,
}
impl PrivateKeys {
    pub fn signing_secret(&self) -> &SignedSecretSubKey {
        self.keys
            .secret_subkeys
            .iter()
            .filter(|k| k.signed_public_key().key.is_signing_key())
            .next()
            .unwrap()
    }
    pub fn public_keys(&self) -> String {
        self.keys
            .signed_public_key()
            .to_armored_string(ArmorOptions::default())
            .unwrap()
    }

    /// returns (data, signature, issuers)
    #[tracing::instrument]
    pub fn decrypt(
        &self,
        passphrase: &str,
        armor: &str,
    ) -> Result<(Vec<u8>, Option<String>, Vec<String>), Error> {
        let (msg, _) =
            Message::from_string(armor).map_err(|e| Error::DecryptionError(e.to_string()))?;
        let mut decrypted = msg
            .decrypt(&Password::from(passphrase), &self.keys)
            .map_err(|e| Error::DecryptionError(e.to_string()))?;
        let data = decrypted
            .as_data_vec()
            .map_err(|e| Error::DecryptionError(e.to_string()))?;
        let signature = match &decrypted {
            Message::Signed { reader, .. } => Some(reader.signature()),
            Message::SignedOnePass { reader, .. } => reader.signature(),
            _ => None,
        };
        let issuers = signature
            .map(|v| v.issuer().iter().map(|w| w.to_string()).collect())
            .unwrap_or(Vec::new());
        let signature = signature.map_or(Ok(None), |v| {
            DetachedSignature::new(v.clone())
                .to_armored_string(ArmorOptions::default())
                .map(Some)
                .map_err(|e| Error::VerificationError(e.to_string()))
        })?;
        Ok((data, signature, issuers))
    }

    #[tracing::instrument]
    pub fn sign(&self, passphrase: &str, data: Vec<u8>) -> Result<String, Error> {
        let mut builder = MessageBuilder::from_bytes("", data);
        builder.sign(
            &self.signing_secret().key,
            Password::from(passphrase),
            crypto::hash::HashAlgorithm::Sha512,
        );
        builder
            .to_armored_string(OsRng, ArmorOptions::default())
            .map_err(|e| Error::SigningError(e.to_string()))
    }
    /// 主鍵のパスフレーズを検証する。
    pub fn validate_main_passphrase(&self, passphrase: &str) -> Result<(), Error> {
        self.keys
            .unlock(&Password::from(passphrase), |_, _| Ok(()))
            .map_err(|e| Error::KeyFormatError(e.to_string()))?
            .map_err(|e: pgp::errors::Error| Error::KeyFormatError(e.to_string()))
    }

    /// サブ鍵のパスフレーズを検証する。
    pub fn validate_sub_passphrase(&self, passphrase: &str) -> Result<(), Error> {
        self.signing_secret()
            .unlock(&Password::from(passphrase), |_, _| Ok(()))
            .map_err(|e| Error::KeyFormatError(e.to_string()))?
            .map_err(|e: pgp::errors::Error| Error::KeyFormatError(e.to_string()))
    }

    /// 複数受信者の公開鍵宛に署名+暗号化する。
    /// 各受信者は自分の秘密鍵で復号できる。
    #[tracing::instrument]
    pub fn sign_and_encrypt(
        &self,
        passphrase: &str,
        recipients: &[&PublicKeys],
        data: Vec<u8>,
    ) -> Result<String, Error> {
        let mut builder = MessageBuilder::from_bytes("", data)
            .seipd_v1(OsRng::default(), crypto::sym::SymmetricKeyAlgorithm::AES256);
        builder.sign(
            &self.signing_secret().key,
            Password::from(passphrase),
            crypto::hash::HashAlgorithm::Sha512,
        );
        for recipient in recipients {
            builder
                .encrypt_to_key(OsRng::default(), recipient.encryption_public())
                .map_err(|e| Error::SigningError(e.to_string()))?;
        }
        builder
            .to_armored_string(OsRng::default(), ArmorOptions::default())
            .map_err(|e| Error::SigningError(e.to_string()))
    }
}
impl TryFrom<&str> for PrivateKeys {
    type Error = Error;
    fn try_from(value: &str) -> Result<Self, Error> {
        let (keys, _) = SignedSecretKey::from_string(value)
            .map_err(|e| Error::KeyFormatError(e.to_string()))?;
        let subkeys = &keys.secret_subkeys;
        if subkeys
            .iter()
            .find(|k| k.public_key().is_signing_key())
            .is_none()
            || subkeys
                .iter()
                .find(|k| k.public_key().is_encryption_key())
                .is_none()
        {
            Err(Error::KeyFormatError(
                "both of signing sub key and encryption sub key required".to_string(),
            ))
        } else {
            Ok(PrivateKeys { keys })
        }
    }
}

#[derive(Debug)]
pub struct PublicKeys {
    keys: SignedPublicKey,
}
impl PublicKeys {
    pub fn encryption_public(&self) -> &SignedPublicSubKey {
        self.keys
            .public_subkeys
            .iter()
            .filter(|k| k.key.is_encryption_key())
            .next()
            .unwrap()
    }
    pub fn signing_public(&self) -> &SignedPublicSubKey {
        self.keys
            .public_subkeys
            .iter()
            .filter(|k| k.key.is_signing_key())
            .next()
            .unwrap()
    }

    pub fn get_signing_sub_key_id(&self) -> String {
        self.signing_public().key_id().to_string()
    }
    pub fn get_user_ids(&self) -> Vec<String> {
        self.keys
            .details
            .users
            .iter()
            .map(|v| v.id.to_string())
            .collect()
    }

    #[tracing::instrument]
    pub fn verify(&self, armored: &str) -> Result<(), Error> {
        let (mut msg, _) =
            Message::from_string(armored).map_err(|e| Error::VerificationError(e.to_string()))?;
        msg.verify_read(self.signing_public())
            .map(|_| ())
            .map_err(|e| Error::VerificationError(e.to_string()))
    }
    #[tracing::instrument]
    pub fn verify_detached_signature(&self, armored: &str, data: &[u8]) -> Result<(), Error> {
        let (sig, _) = DetachedSignature::from_string(armored)
            .map_err(|e| Error::VerificationError(e.to_string()))?;
        sig.verify(self.signing_public(), data)
            .map_err(|e| Error::VerificationError(e.to_string()))
    }
}
impl TryFrom<&str> for PublicKeys {
    type Error = Error;
    fn try_from(value: &str) -> Result<Self, Error> {
        let (keys, _) = SignedPublicKey::from_string(value)
            .map_err(|e| Error::KeyFormatError(e.to_string()))?;
        let subkeys = &keys.public_subkeys;
        if subkeys.iter().find(|k| k.is_signing_key()).is_none()
            || subkeys.iter().find(|k| k.is_encryption_key()).is_none()
        {
            Err(Error::KeyFormatError(
                "both of signing sub key and encryption sub key required".to_string(),
            ))
        } else {
            Ok(PublicKeys { keys })
        }
    }
}

// (main, subkeys)
pub fn generate_keys(
    user_id: String,
    main_passphrase: String,
    sub_passphrase: String,
) -> Result<(String, String), Error> {
    let signing_key_param = SubkeyParamsBuilder::default()
        .version(KeyVersion::V4)
        .key_type(KeyType::Ed25519Legacy)
        .can_sign(true)
        .can_encrypt(false)
        .can_authenticate(false)
        .passphrase(Some(sub_passphrase.clone()))
        .build()
        .map_err(|e| Error::KeyGenerationError(e.to_string()))?;
    let encryption_key_param = SubkeyParamsBuilder::default()
        .version(KeyVersion::V4)
        .key_type(KeyType::ECDH(crypto::ecc_curve::ECCCurve::Curve25519))
        .can_sign(false)
        .can_encrypt(true)
        .can_authenticate(false)
        .passphrase(Some(sub_passphrase.clone()))
        .build()
        .map_err(|e| Error::KeyGenerationError(e.to_string()))?;

    let params = SecretKeyParamsBuilder::default()
        .version(KeyVersion::V4)
        .key_type(KeyType::Ed25519Legacy)
        .feature_seipd_v1(true)
        .can_sign(true)
        .can_encrypt(false)
        .can_authenticate(false)
        .passphrase(Some(main_passphrase.clone()))
        .subkeys(vec![signing_key_param, encryption_key_param])
        .primary_user_id(user_id.clone())
        .build()
        .map_err(|e| Error::KeyGenerationError(e.to_string()))?;

    let keys = params
        .generate(OsRng::default())
        .map_err(|e| Error::KeyGenerationError(e.to_string()))?;
    let signed = keys
        .sign(OsRng::default(), &main_passphrase.into())
        .map_err(|e| Error::KeyGenerationError(e.to_string()))?;
    let main = signed
        .to_armored_string(ArmorOptions::default())
        .map_err(|e| Error::KeyGenerationError(e.to_string()))?;

    let subkeys = signed
        .to_armored_string(ArmorOptions::default())
        .map_err(|e| Error::KeyGenerationError(e.to_string()))?;

    Ok((main, subkeys))
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn import() {
        let data = r#"-----BEGIN PGP PRIVATE KEY BLOCK-----

lDsEaTbGJBYJKwYBBAHaRw8BAQdAp6aPVewDe1fdSZ1thxof1vlP4TYDLM6kaTMd
sj0d8W3/AGUAR05VAbQaWXVraSBPa2Ftb3RvIDxjb3JkQHg1Ni5qcD6ImQQTFgoA
QRYhBC0ecY6PYdqDFmSC/tijUm4txUMyBQJpNsYkAhsDBQkFo5qABQsJCAcCAiIC
BhUKCQgLAgQWAgMBAh4HAheAAAoJENijUm4txUMySBEBAKYsJT7pq4TbtbOr3BsH
us6r6KJo/hzAlqC37H6mJyM5AP9AM62C7EohkuyFKoMrDH5/aL1kpwj/PleObECz
d8KQD5yLBGk2xiQSCisGAQQBl1UBBQEBB0C/rNATFM91DB9jb+HdCZuseesbpKeF
k8Z0A7S05AM+cwMBCAf+BwMCWRvn/JdEonv/Vp10L1jgDKMLrLnDq5lwlYWabvDR
6vLejK1B+MIRP7a6bq/PLqnzmyEF2fK2eXbW8BXs96eERXhyvMxgvkZ3tAz9uFL8
k4h+BBgWCgAmFiEELR5xjo9h2oMWZIL+2KNSbi3FQzIFAmk2xiQCGwwFCQWjmoAA
CgkQ2KNSbi3FQzKU0gEA6eHqcaDbcvK59nUbAKKHGF2SZmCCmtf4IW4q5vUtlQQA
/2zSnWf8dRhTfBSZTwYfJOPE/eWEmrhOdKX/IdKzgHENnIsEaTf4yhIKKwYBBAGX
VQEFAQEHQPujkuj1lvnFtQ3DxzksgJsQF6dQD7WAYsyqvO6ICYJpAwEIB/4HAwKn
K0v/7mVEzv/z5vLI8/9I77pbURw9/H+hebp8USRpSqgOZbLIpEnegyktYP/frszn
+gJPZZ2TPIv7ebAdc85ndmjLbSXRecHtjOH7SGsAiHgEGBYKACAWIQQtHnGOj2Ha
gxZkgv7Yo1JuLcVDMgUCaTf4ygIbDAAKCRDYo1JuLcVDMl87AP0ZZx5RRF3qucqT
dE79CYvM0aGu/Zs/J/lxDphQhzOjnQD9EW4673Xyzkk/DWPoPZY6uInWGSXzMzvB
QV3hL3V6GgI=
=rd+K
-----END PGP PRIVATE KEY BLOCK-----"#;
        let subkeys = PrivateKeys::try_from(data).unwrap();
        dbg!(subkeys.keys);
    }
}
