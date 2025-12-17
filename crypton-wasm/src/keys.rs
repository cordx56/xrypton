use crate::*;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use pgp::{armor, bytes::Bytes, composed::*, crypto, packet, ser::Serialize, types::*};
use rand::rngs::OsRng;

#[derive(Debug)]
pub enum PrivateKeyType {
    Signing,
    Encryption,
}

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
    pub fn encryption_secret(&self) -> &SignedSecretSubKey {
        self.keys
            .secret_subkeys
            .iter()
            .filter(|k| k.signed_public_key().key.is_encryption_key())
            .next()
            .unwrap()
    }

    pub fn public_keys(&self) -> String {
        self.keys
            .signed_public_key()
            .to_armored_string(ArmorOptions::default())
            .unwrap()
    }

    #[tracing::instrument]
    pub fn encrypt(&self, plain: Vec<u8>) -> Result<String, Error> {
        let mut builder = MessageBuilder::from_bytes("", plain)
            .seipd_v1(OsRng::default(), crypto::sym::SymmetricKeyAlgorithm::AES256);
        builder
            .encrypt_to_key(
                OsRng::default(),
                &self.encryption_secret().signed_public_key(),
            )
            .map_err(|e| Error::EncryptionError(e.to_string()))?;
        builder
            .to_armored_string(OsRng::default(), ArmorOptions::default())
            .map_err(|e| Error::EncryptionError(e.to_string()))
    }
    /// returns (signer, data)
    #[tracing::instrument]
    pub fn decrypt(
        &self,
        passphrase: &str,
        armor: &str,
    ) -> Result<(Option<String>, Vec<u8>), Error> {
        let (msg, _) =
            Message::from_string(armor).map_err(|e| Error::DecryptionError(e.to_string()))?;
        let mut decrypted = msg
            .decrypt(&Password::from(passphrase), &self.keys)
            .map_err(|e| Error::DecryptionError(e.to_string()))?;
        let signer = match &decrypted {
            Message::Signed { reader, .. } => reader
                .signature()
                .signers_userid()
                .map(|v| String::from_utf8(v.to_vec()).ok())
                .flatten(),
            _ => None,
        };
        Ok((
            signer,
            decrypted
                .as_data_vec()
                .map_err(|e| Error::DecryptionError(e.to_string()))?,
        ))
    }

    #[tracing::instrument]
    pub fn sign(&self, passphrase: &str, data: Vec<u8>) -> Result<String, Error> {
        let mut builder = MessageBuilder::from_bytes("", data)
            .seipd_v1(OsRng::default(), crypto::sym::SymmetricKeyAlgorithm::AES256);
        builder.sign(
            &self.signing_secret().key,
            Password::from(passphrase),
            crypto::hash::HashAlgorithm::Sha512,
        );
        builder
            .to_armored_string(OsRng::default(), ArmorOptions::default())
            .map_err(|e| Error::SigningError(e.to_string()))
    }
    #[tracing::instrument]
    pub fn sign_and_encrypt(
        &self,
        passphrase: &str,
        public: &PublicKeys,
        data: Vec<u8>,
    ) -> Result<String, Error> {
        let mut builder = MessageBuilder::from_bytes("", data)
            .seipd_v1(OsRng::default(), crypto::sym::SymmetricKeyAlgorithm::AES256);
        builder
            .sign(
                &self.signing_secret().key,
                Password::from(passphrase),
                crypto::hash::HashAlgorithm::Sha512,
            )
            .encrypt_to_key(OsRng::default(), public.encryption_public())
            .map_err(|e| Error::SigningError(e.to_string()))?;
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

    #[tracing::instrument]
    pub fn encrypt(&self, plain: Vec<u8>) -> Result<String, Error> {
        let mut builder = MessageBuilder::from_bytes("", plain)
            .seipd_v1(OsRng::default(), crypto::sym::SymmetricKeyAlgorithm::AES256);
        builder
            .encrypt_to_key(OsRng::default(), &self.encryption_public())
            .map_err(|e| Error::EncryptionError(e.to_string()))?;
        builder
            .to_armored_string(OsRng::default(), ArmorOptions::default())
            .map_err(|e| Error::EncryptionError(e.to_string()))
    }
    #[tracing::instrument]
    pub fn verify(&self, armored_or_base64: &str) -> Result<(), Error> {
        let verify = |msg: Message<'_>| {
            msg.verify(self.signing_public())
                .map(|_| ())
                .map_err(|e| Error::VerificationError(e.to_string()))
        };

        match Message::from_string(armored_or_base64).map(|v| v.0) {
            Ok(v) => verify(v),
            Err(_) => {
                let decoded = URL_SAFE
                    .decode(armored_or_base64)
                    .map_err(|e| Error::VerificationError(e.to_string()))?;
                let msg = Message::from_bytes(decoded.as_slice())
                    .map_err(|e| Error::VerificationError(e.to_string()))?;
                verify(msg)
            }
        }
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

fn make_secret_key_stub(secret: &mut SignedSecretKey) -> Result<(), Error> {
    let primary_key = &mut secret.primary_key;
    if let SecretParams::Encrypted(params) = primary_key.secret_params() {
        /*
        let s2k_params = S2kParams::Cfb {
            sym_alg: crypto::sym::SymmetricKeyAlgorithm::Plaintext,
            s2k: StringToKey::Private {
                typ: 101,
                unknown: Bytes::new(),
            },
            iv: Bytes::new(),
        };
        */
        let new_params =
            EncryptedSecretParams::new(Bytes::new(), params.string_to_key_params().clone());
        let secret_params = SecretParams::Encrypted(new_params);
        let public_key = primary_key.public_key().clone();
        let secret_key = packet::SecretKey::new(public_key, secret_params)
            .map_err(|e| Error::KeyGenerationError(e.to_string()))?;
        *primary_key = secret_key;
        Ok(())
    } else {
        Err(Error::KeyFormatError(
            "invalid secret key format".to_string(),
        ))
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

    let subkeys = signed.clone();
    //make_secret_key_stub(&mut subkeys)?;
    let subkeys = subkeys
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

    #[test]
    fn encrypt_and_decrypt() {
        let pass = "passphrase";
        let user_id = "cordx56 <cord@x56.jp>";
        let (_, subkeys) =
            generate_keys(user_id.to_string(), pass.to_string(), pass.to_string()).unwrap();
        println!("{subkeys}");

        let subkeys = PrivateKeys::try_from(subkeys.as_str()).unwrap();
        dbg!(&subkeys);

        let plain = b"Hello, world!";
        let encrypted = subkeys.encrypt(plain.to_vec()).unwrap();
        dbg!(&encrypted);

        //let decrypted = subkeys.decrypt(pass, &encrypted).unwrap();

        //assert_eq!(&decrypted, plain);
    }
}
