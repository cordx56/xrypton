use crate::*;
use chrono::Timelike;
use pgp::{
    composed::*,
    crypto,
    packet::{Subpacket, SubpacketData},
    types::{CompressionAlgorithm, KeyDetails, *},
};
use rand::rngs::OsRng;

/// (plaintext, detached_signature, issuer_key_ids)
pub type DecryptResult = (Vec<u8>, Option<String>, Vec<String>);

#[derive(Debug)]
pub struct PrivateKeys {
    keys: SignedSecretKey,
}
impl PrivateKeys {
    pub fn signing_secret(&self) -> &SignedSecretSubKey {
        self.keys
            .secret_subkeys
            .iter()
            .find(|k| k.signed_public_key().key.is_signing_key())
            .unwrap()
    }
    pub fn get_user_ids(&self) -> Vec<String> {
        self.keys
            .signed_public_key()
            .details
            .users
            .iter()
            .filter_map(|v| v.id.as_str().map(str::to_owned))
            .collect()
    }
    pub fn public_keys(&self) -> String {
        self.keys
            .signed_public_key()
            .to_armored_string(ArmorOptions::default())
            .unwrap()
    }

    /// SignersUserIDサブパケットを含む署名用SubpacketConfigを生成する。
    fn sign_subpacket_config(&self) -> Result<SubpacketConfig, Error> {
        // UserId::to_string()はデバッグ用フォーマット("User ID: ...")を返すため、
        // as_str()で生のユーザID文字列を取得する
        let user_id = self
            .keys
            .signed_public_key()
            .details
            .users
            .first()
            .and_then(|u| u.id.as_str().map(str::to_owned))
            .unwrap_or_default();
        let signing_key = &self.signing_secret().key;
        let hashed = vec![
            Subpacket::regular(SubpacketData::IssuerFingerprint(signing_key.fingerprint()))
                .map_err(|e| Error::SigningError(e.to_string()))?,
            Subpacket::regular(SubpacketData::SignatureCreationTime(
                chrono::Utc::now().with_nanosecond(0).unwrap(),
            ))
            .map_err(|e| Error::SigningError(e.to_string()))?,
            Subpacket::regular(SubpacketData::SignersUserID(user_id.into()))
                .map_err(|e| Error::SigningError(e.to_string()))?,
        ];
        let unhashed = vec![
            Subpacket::regular(SubpacketData::Issuer(signing_key.key_id()))
                .map_err(|e| Error::SigningError(e.to_string()))?,
        ];
        Ok(SubpacketConfig::UserDefined { hashed, unhashed })
    }

    /// returns (data, signature, issuers)
    #[tracing::instrument]
    pub fn decrypt(&self, passphrase: &str, armor: &str) -> Result<DecryptResult, Error> {
        let (msg, _) =
            Message::from_string(armor).map_err(|e| Error::DecryptionError(e.to_string()))?;
        let msg = msg
            .decompress()
            .map_err(|e| Error::DecryptionError(e.to_string()))?;
        Self::decrypt_message(msg, passphrase, &self.keys)
    }

    /// raw PGP bytes から復号する。
    #[tracing::instrument]
    pub fn decrypt_from_bytes(&self, passphrase: &str, raw: &[u8]) -> Result<DecryptResult, Error> {
        let msg = Message::from_bytes(std::io::Cursor::new(raw))
            .map_err(|e| Error::DecryptionError(e.to_string()))?;
        let msg = msg
            .decompress()
            .map_err(|e| Error::DecryptionError(e.to_string()))?;
        Self::decrypt_message(msg, passphrase, &self.keys)
    }

    fn decrypt_message(
        msg: Message,
        passphrase: &str,
        keys: &SignedSecretKey,
    ) -> Result<DecryptResult, Error> {
        let mut decrypted = msg
            .decrypt(&Password::from(passphrase), keys)
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

    /// 署名済みメッセージビルダーを構築し、`finish` で出力形式を決定する。
    fn build_sign<T>(
        &self,
        passphrase: &str,
        data: Vec<u8>,
        finish: impl FnOnce(MessageBuilder<'_>) -> Result<T, pgp::errors::Error>,
    ) -> Result<T, Error> {
        let mut builder = MessageBuilder::from_bytes("", data);
        builder.compression(CompressionAlgorithm::ZLIB);
        builder.sign_with_subpackets(
            &self.signing_secret().key,
            Password::from(passphrase),
            crypto::hash::HashAlgorithm::Sha512,
            self.sign_subpacket_config()?,
        );
        finish(builder).map_err(|e| Error::SigningError(e.to_string()))
    }

    /// armored テキストで署名する。
    #[tracing::instrument]
    pub fn sign(&self, passphrase: &str, data: Vec<u8>) -> Result<String, Error> {
        self.build_sign(passphrase, data, |b| {
            b.to_armored_string(OsRng, ArmorOptions::default())
        })
    }

    /// raw PGP バイト列で署名する。
    #[tracing::instrument]
    pub fn sign_bytes(&self, passphrase: &str, data: Vec<u8>) -> Result<Vec<u8>, Error> {
        self.build_sign(passphrase, data, |b| b.to_vec(OsRng))
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

    /// `Signed(Encrypted(Signed(Data)))` の外側署名済みメッセージビルダーを構築し、
    /// `finish` クロージャで最終出力形式を決定する。
    fn build_sign_encrypt_sign<T>(
        &self,
        passphrase: &str,
        recipients: &[&PublicKeys],
        data: Vec<u8>,
        finish: impl FnOnce(MessageBuilder<'_>) -> Result<T, pgp::errors::Error>,
    ) -> Result<T, Error> {
        // inner: sign + encrypt → raw PGP bytes
        let mut inner = MessageBuilder::from_bytes("", data)
            .seipd_v1(OsRng, crypto::sym::SymmetricKeyAlgorithm::AES256);
        inner.sign_with_subpackets(
            &self.signing_secret().key,
            Password::from(passphrase),
            crypto::hash::HashAlgorithm::Sha512,
            self.sign_subpacket_config()?,
        );
        for recipient in recipients {
            inner
                .encrypt_to_key(OsRng, recipient.encryption_public())
                .map_err(|e| Error::EncryptionError(e.to_string()))?;
        }
        let inner_bytes = inner
            .to_vec(OsRng)
            .map_err(|e| Error::EncryptionError(e.to_string()))?;

        // outer: sign（サーバが検証可能）— 圧縮は最外層のみ
        let mut outer = MessageBuilder::from_bytes("", inner_bytes);
        outer.compression(CompressionAlgorithm::ZLIB);
        outer.sign_with_subpackets(
            &self.signing_secret().key,
            Password::from(passphrase),
            crypto::hash::HashAlgorithm::Sha512,
            self.sign_subpacket_config()?,
        );
        finish(outer).map_err(|e| Error::SigningError(e.to_string()))
    }

    /// `Signed(Encrypted(Signed(Data)))` 構造を armored テキストで返す。
    #[tracing::instrument]
    pub fn sign_encrypt_sign(
        &self,
        passphrase: &str,
        recipients: &[&PublicKeys],
        data: Vec<u8>,
    ) -> Result<String, Error> {
        self.build_sign_encrypt_sign(passphrase, recipients, data, |b| {
            b.to_armored_string(OsRng, ArmorOptions::default())
        })
    }

    /// `Signed(Encrypted(Signed(Data)))` 構造を raw PGP バイト列で返す。
    #[tracing::instrument]
    pub fn sign_encrypt_sign_bin(
        &self,
        passphrase: &str,
        recipients: &[&PublicKeys],
        data: Vec<u8>,
    ) -> Result<Vec<u8>, Error> {
        self.build_sign_encrypt_sign(passphrase, recipients, data, |b| b.to_vec(OsRng))
    }
}
impl TryFrom<&str> for PrivateKeys {
    type Error = Error;
    fn try_from(value: &str) -> Result<Self, Error> {
        let (keys, _) = SignedSecretKey::from_string(value)
            .map_err(|e| Error::KeyFormatError(e.to_string()))?;
        let subkeys = &keys.secret_subkeys;
        if !subkeys.iter().any(|k| k.public_key().is_signing_key())
            || !subkeys.iter().any(|k| k.public_key().is_encryption_key())
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
            .find(|k| k.key.is_encryption_key())
            .unwrap()
    }
    pub fn signing_public(&self) -> &SignedPublicSubKey {
        self.keys
            .public_subkeys
            .iter()
            .find(|k| k.key.is_signing_key())
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
            .filter_map(|v| v.id.as_str().map(str::to_owned))
            .collect()
    }

    #[tracing::instrument]
    pub fn verify(&self, armored: &str) -> Result<(), Error> {
        let (msg, _) =
            Message::from_string(armored).map_err(|e| Error::VerificationError(e.to_string()))?;
        let mut msg = msg
            .decompress()
            .map_err(|e| Error::VerificationError(e.to_string()))?;
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
        if !subkeys.iter().any(|k| k.is_signing_key())
            || !subkeys.iter().any(|k| k.is_encryption_key())
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
        .generate(OsRng)
        .map_err(|e| Error::KeyGenerationError(e.to_string()))?;
    let signed = keys
        .sign(OsRng, &main_passphrase.into())
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
