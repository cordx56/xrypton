use pgp::composed::*;
use pgp::packet::{Packet, PacketParser, Signature};
use pgp::ser::Serialize;
use pgp::types::{KeyDetails, PublicKeyTrait, SignedUser, SignedUserAttribute, Tag};

use crate::error::XryptonError;

/// PGPユーザIDから `[ID]@[domain]` 形式のアドレス部分を抽出する。
///
/// 対応形式:
/// - `user@domain` → `user@domain`
/// - `Real Name <user@domain>` → `user@domain`
pub fn extract_address_from_uid(uid: &str) -> Result<&str, XryptonError> {
    if let Some(start) = uid.find('<') {
        let end = uid
            .find('>')
            .ok_or_else(|| XryptonError::KeyFormat("unclosed '<' in user ID".into()))?;
        if start >= end {
            return Err(XryptonError::KeyFormat(
                "invalid angle bracket position in user ID".into(),
            ));
        }
        let addr = uid[start + 1..end].trim();
        if !addr.contains('@') {
            return Err(XryptonError::KeyFormat(
                "no '@' found in user ID address".into(),
            ));
        }
        return Ok(addr);
    }
    if uid.contains('@') {
        return Ok(uid);
    }
    Err(XryptonError::KeyFormat(
        "no address found in user ID".into(),
    ))
}

/// PGP署名メッセージからSignersUserIDサブパケットの値を抽出し、
/// `[ID]@[domain]` 形式に正規化して返す。
///
/// `Real Name <user@domain>` 形式の場合はアドレス部分のみ返す。
/// 連合フローで署名者のホームサーバを特定するために使用する。
pub fn extract_signer_user_id(armored: &str) -> Result<String, XryptonError> {
    use pgp::armor::Dearmor;
    use std::io::{BufReader, Read};

    let mut dearmor = Dearmor::new(BufReader::new(armored.as_bytes()));
    let mut bytes = Vec::new();
    dearmor
        .read_to_end(&mut bytes)
        .map_err(|e| XryptonError::Verification(format!("dearmor failed: {e}")))?;

    extract_signer_user_id_from_bytes(&bytes)
}

/// raw PGP バイト列から SignersUserID を抽出する。
///
/// CompressedData パケットがあれば展開してから内部パケットを走査する。
fn extract_signer_user_id_from_bytes(data: &[u8]) -> Result<String, XryptonError> {
    use pgp::packet::{Packet, PacketParser};
    use std::io::{BufReader, Read};

    let parser = PacketParser::new(BufReader::new(data));

    for result in parser.flatten() {
        match result {
            Packet::Signature(ref sig) if sig.signers_userid().is_some() => {
                let uid = sig.signers_userid().unwrap();
                let raw = String::from_utf8(uid.to_vec()).map_err(|e| {
                    XryptonError::Verification(format!("invalid UTF-8 in SignersUserID: {e}"))
                })?;
                return extract_address_from_uid(&raw)
                    .map(str::to_owned)
                    .map_err(|e| {
                        XryptonError::Verification(format!("invalid SignersUserID format: {e}"))
                    });
            }
            Packet::CompressedData(ref cd) => {
                let mut decompressed = Vec::new();
                cd.decompress()
                    .map_err(|e| XryptonError::Verification(format!("decompress failed: {e}")))?
                    .read_to_end(&mut decompressed)
                    .map_err(|e| {
                        XryptonError::Verification(format!("decompress read failed: {e}"))
                    })?;
                return extract_signer_user_id_from_bytes(&decompressed);
            }
            _ => continue,
        }
    }

    Err(XryptonError::Verification(
        "no SignersUserID subpacket found in message".into(),
    ))
}

/// PGP署名メッセージから署名者の鍵IDを検証なしで抽出する。
///
/// OnePassSignature パケットまたは Signature パケットの issuer 情報を使用する。
pub fn extract_issuer_key_id(armored: &str) -> Result<String, XryptonError> {
    use pgp::armor::Dearmor;
    use std::io::{BufReader, Read};

    let mut dearmor = Dearmor::new(BufReader::new(armored.as_bytes()));
    let mut bytes = Vec::new();
    dearmor
        .read_to_end(&mut bytes)
        .map_err(|e| XryptonError::Verification(format!("dearmor failed: {e}")))?;

    extract_issuer_key_id_from_bytes(&bytes)
}

/// PGP署名メッセージから署名者のフィンガープリントを検証なしで抽出する。
///
/// Signature パケットの issuer_fingerprint 情報を使用する。
pub fn extract_issuer_fingerprint(armored: &str) -> Result<String, XryptonError> {
    use pgp::armor::Dearmor;
    use std::io::{BufReader, Read};

    let mut dearmor = Dearmor::new(BufReader::new(armored.as_bytes()));
    let mut bytes = Vec::new();
    dearmor
        .read_to_end(&mut bytes)
        .map_err(|e| XryptonError::Verification(format!("dearmor failed: {e}")))?;

    extract_issuer_fingerprint_from_bytes(&bytes)
}

/// raw PGP バイト列から署名者の鍵IDを検証なしで抽出する。
///
/// CompressedData パケットがあれば展開してから内部パケットを走査する。
pub fn extract_issuer_key_id_from_bytes(data: &[u8]) -> Result<String, XryptonError> {
    use pgp::packet::{OpsVersionSpecific, Packet, PacketParser};
    use std::io::{BufReader, Read};

    let parser = PacketParser::new(BufReader::new(data));

    for result in parser.flatten() {
        match result {
            Packet::OnePassSignature(ref ops) => {
                if let OpsVersionSpecific::V3 { key_id } = ops.version_specific() {
                    return Ok(key_id.to_string());
                }
            }
            Packet::Signature(ref sig) => {
                if let Some(key_id) = sig.issuer().first() {
                    return Ok(key_id.to_string());
                }
            }
            Packet::CompressedData(ref cd) => {
                let mut decompressed = Vec::new();
                cd.decompress()
                    .map_err(|e| XryptonError::Verification(format!("decompress failed: {e}")))?
                    .read_to_end(&mut decompressed)
                    .map_err(|e| {
                        XryptonError::Verification(format!("decompress read failed: {e}"))
                    })?;
                return extract_issuer_key_id_from_bytes(&decompressed);
            }
            _ => continue,
        }
    }

    Err(XryptonError::Verification(
        "no issuer key ID found in message".into(),
    ))
}

/// raw PGP バイト列から署名者のフィンガープリントを検証なしで抽出する。
///
/// CompressedData パケットがあれば展開してから内部パケットを走査する。
pub fn extract_issuer_fingerprint_from_bytes(data: &[u8]) -> Result<String, XryptonError> {
    use std::io::{BufReader, Read};

    let parser = PacketParser::new(BufReader::new(data));

    for result in parser.flatten() {
        match result {
            Packet::Signature(ref sig) => {
                if let Some(fingerprint) = sig.issuer_fingerprint().first() {
                    return Ok(format!("{fingerprint:X}"));
                }
            }
            Packet::CompressedData(ref cd) => {
                let mut decompressed = Vec::new();
                cd.decompress()
                    .map_err(|e| XryptonError::Verification(format!("decompress failed: {e}")))?
                    .read_to_end(&mut decompressed)
                    .map_err(|e| {
                        XryptonError::Verification(format!("decompress read failed: {e}"))
                    })?;
                return extract_issuer_fingerprint_from_bytes(&decompressed);
            }
            _ => continue,
        }
    }

    Err(XryptonError::Verification(
        "no issuer fingerprint found in message".into(),
    ))
}

#[derive(Debug, Clone)]
pub struct CertificationSignatureInfo {
    pub issuer_fingerprint: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub is_certification: bool,
}

fn first_signature_from_bytes(data: &[u8]) -> Result<Signature, XryptonError> {
    use std::io::{BufReader, Read};

    let parser = PacketParser::new(BufReader::new(data));
    for result in parser.flatten() {
        match result {
            Packet::Signature(sig) => return Ok(sig),
            Packet::CompressedData(cd) => {
                let mut decompressed = Vec::new();
                cd.decompress()
                    .map_err(|e| XryptonError::Verification(format!("decompress failed: {e}")))?
                    .read_to_end(&mut decompressed)
                    .map_err(|e| {
                        XryptonError::Verification(format!("decompress read failed: {e}"))
                    })?;
                return first_signature_from_bytes(&decompressed);
            }
            _ => {}
        }
    }

    Err(XryptonError::Verification(
        "no signature packet found".into(),
    ))
}

pub fn parse_certification_signature_info_from_bytes(
    data: &[u8],
) -> Result<CertificationSignatureInfo, XryptonError> {
    let sig = first_signature_from_bytes(data)?;
    let issuer_fingerprint = sig
        .issuer_fingerprint()
        .first()
        .map(|fp| format!("{fp:X}"))
        .ok_or_else(|| XryptonError::Verification("missing issuer fingerprint".into()))?;
    let created_at = *sig
        .created()
        .ok_or_else(|| XryptonError::Verification("missing signature creation time".into()))?;

    Ok(CertificationSignatureInfo {
        issuer_fingerprint,
        created_at,
        is_certification: sig.is_certification(),
    })
}

fn verify_against_users<S>(sig: &Signature, target_key: &SignedPublicKey, signer_key: &S) -> bool
where
    S: PublicKeyTrait + Serialize,
{
    let verify_user = |u: &SignedUser| {
        sig.verify_third_party_certification(target_key, signer_key, Tag::UserId, &u.id)
            .is_ok()
    };
    let verify_attr = |a: &SignedUserAttribute| {
        sig.verify_third_party_certification(target_key, signer_key, Tag::UserAttribute, &a.attr)
            .is_ok()
    };

    target_key.details.users.iter().any(verify_user)
        || target_key.details.user_attributes.iter().any(verify_attr)
}

fn verify_against_signer_candidates(
    sig: &Signature,
    target_key: &SignedPublicKey,
    signer_key: &SignedPublicKey,
) -> bool {
    // 署名がサブキーで作成されるケースもあるため、
    // 主鍵に加えて署名可能サブキーも検証候補に含める。
    verify_against_users(sig, target_key, signer_key)
        || signer_key
            .public_subkeys
            .iter()
            .filter(|subkey| subkey.key.is_signing_key())
            .any(|subkey| verify_against_users(sig, target_key, subkey))
}

pub fn verify_certification_signature_for_target(
    signer_public_key: &str,
    target_public_key: &str,
    signature_bytes: &[u8],
) -> Result<bool, XryptonError> {
    let (signer_key, _) = SignedPublicKey::from_string(signer_public_key)
        .map_err(|e| XryptonError::KeyFormat(e.to_string()))?;
    let (target_key, _) = SignedPublicKey::from_string(target_public_key)
        .map_err(|e| XryptonError::KeyFormat(e.to_string()))?;

    let sig = first_signature_from_bytes(signature_bytes)?;
    if !sig.is_certification() {
        return Ok(false);
    }

    Ok(verify_against_signer_candidates(
        &sig,
        &target_key,
        &signer_key,
    ))
}

/// Server-side public key holder for signature verification.
#[derive(Debug)]
pub struct PublicKeys {
    keys: SignedPublicKey,
}

impl PublicKeys {
    fn signing_public(&self) -> Result<&SignedPublicSubKey, XryptonError> {
        self.keys
            .public_subkeys
            .iter()
            .find(|k| k.key.is_signing_key())
            .ok_or_else(|| XryptonError::KeyFormat("no signing subkey found".into()))
    }

    /// Returns the key ID of the signing subkey (hex string).
    pub fn get_signing_sub_key_id(&self) -> Result<String, XryptonError> {
        Ok(self.signing_public()?.key_id().to_string())
    }

    /// 主鍵のフィンガープリントを大文字16進文字列で返す。
    pub fn get_primary_fingerprint(&self) -> String {
        format!("{:X}", self.keys.fingerprint())
    }

    /// 署名サブキーのフィンガープリントを大文字16進文字列で返す。
    pub fn get_signing_sub_key_fingerprint(&self) -> Result<String, XryptonError> {
        Ok(format!("{:X}", self.signing_public()?.fingerprint()))
    }

    /// PGP公開鍵のプライマリユーザIDからアドレス（`user@domain`）を抽出する。
    pub fn get_primary_user_address(&self) -> Result<String, XryptonError> {
        let uid_str = self
            .keys
            .details
            .users
            .first()
            .and_then(|u| u.id.as_str())
            .ok_or_else(|| XryptonError::KeyFormat("no user ID in public key".into()))?;
        extract_address_from_uid(uid_str).map(str::to_owned)
    }

    /// Verifies a PGP signed message and returns the verified plaintext.
    ///
    /// `verify_read()` は内部で `drain()` を呼びストリームを消費するため、
    /// 先にデータを読み出してからでないとペイロードが空になる。
    /// そのため `as_data_vec()` → `verify_read()` の順で呼ぶ。
    pub fn verify_and_extract(&self, armored: &str) -> Result<Vec<u8>, XryptonError> {
        let (data, verified) = self.extract_and_verify(armored)?;
        if verified {
            Ok(data)
        } else {
            Err(XryptonError::Verification(
                "signature verification failed".to_string(),
            ))
        }
    }

    /// armored PGP メッセージからデータを抽出し、署名検証結果とともに返す。
    /// パース失敗時のみ Err を返し、署名不一致ではデータを返しつつ verified=false とする。
    pub fn extract_and_verify(&self, armored: &str) -> Result<(Vec<u8>, bool), XryptonError> {
        let (msg, _) =
            Message::from_string(armored).map_err(|e| XryptonError::Verification(e.to_string()))?;
        let mut msg = msg
            .decompress()
            .map_err(|e| XryptonError::Verification(e.to_string()))?;
        let signing_key = self.signing_public()?;
        // データを先に読み出す（ハッシュ計算もこの段階で行われる）
        let data = msg
            .as_data_vec()
            .map_err(|e| XryptonError::Verification(e.to_string()))?;
        // 読み出し後に署名を検証する（drain は 0 バイト読み出し → verify のみ実行）
        let verified = msg.verify_read(signing_key).is_ok();
        Ok((data, verified))
    }

    /// raw PGP バイト列の署名を検証してペイロードを取り出す。
    pub fn verify_and_extract_from_bytes(&self, data: &[u8]) -> Result<Vec<u8>, XryptonError> {
        let msg = Message::from_bytes(std::io::Cursor::new(data))
            .map_err(|e| XryptonError::Verification(e.to_string()))?;
        let mut msg = msg
            .decompress()
            .map_err(|e| XryptonError::Verification(e.to_string()))?;
        let signing_key = self.signing_public()?;
        let payload = msg
            .as_data_vec()
            .map_err(|e| XryptonError::Verification(e.to_string()))?;
        msg.verify_read(signing_key)
            .map_err(|e| XryptonError::Verification(e.to_string()))?;
        Ok(payload)
    }

    /// Verifies a PGP signed message without extracting data.
    pub fn verify(&self, armored: &str) -> Result<(), XryptonError> {
        let (msg, _) =
            Message::from_string(armored).map_err(|e| XryptonError::Verification(e.to_string()))?;
        let mut msg = msg
            .decompress()
            .map_err(|e| XryptonError::Verification(e.to_string()))?;
        let signing_key = self.signing_public()?;
        msg.verify_read(signing_key)
            .map(|_| ())
            .map_err(|e| XryptonError::Verification(e.to_string()))
    }
}

impl TryFrom<&str> for PublicKeys {
    type Error = XryptonError;
    fn try_from(value: &str) -> Result<Self, XryptonError> {
        let (keys, _) = SignedPublicKey::from_string(value)
            .map_err(|e| XryptonError::KeyFormat(e.to_string()))?;
        let subkeys = &keys.public_subkeys;
        if !subkeys.iter().any(|k| k.is_signing_key())
            || !subkeys.iter().any(|k| k.is_encryption_key())
        {
            return Err(XryptonError::KeyFormat(
                "both signing and encryption subkeys are required".into(),
            ));
        }
        Ok(PublicKeys { keys })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pgp::composed::{KeyType, SecretKeyParamsBuilder, SubkeyParamsBuilder};
    use pgp::crypto;
    use pgp::types::{CompressionAlgorithm, KeyVersion};
    use rand::rngs::OsRng;

    // --- extract_address_from_uid ---

    #[test]
    fn extract_address_bare() {
        assert_eq!(
            extract_address_from_uid("user@example.com").unwrap(),
            "user@example.com"
        );
    }

    #[test]
    fn extract_address_with_name() {
        assert_eq!(
            extract_address_from_uid("Real Name <user@example.com>").unwrap(),
            "user@example.com"
        );
    }

    #[test]
    fn extract_address_with_name_spaces() {
        // アドレス前後の空白をトリムする
        assert_eq!(
            extract_address_from_uid("Name < user@example.com >").unwrap(),
            "user@example.com"
        );
    }

    #[test]
    fn extract_address_no_at_fails() {
        assert!(extract_address_from_uid("localonly").is_err());
    }

    #[test]
    fn extract_address_unclosed_bracket_fails() {
        assert!(extract_address_from_uid("Name <user@example.com").is_err());
    }

    /// 鍵ペアを生成し、公開鍵からPublicKeysを構築してsigning key IDを取得できることを確認
    #[test]
    fn parse_public_key_and_get_signing_key_id() {
        let signing_sub = SubkeyParamsBuilder::default()
            .version(KeyVersion::V4)
            .key_type(KeyType::Ed25519Legacy)
            .can_sign(true)
            .can_encrypt(false)
            .passphrase(Some("pass".into()))
            .build()
            .unwrap();
        let encryption_sub = SubkeyParamsBuilder::default()
            .version(KeyVersion::V4)
            .key_type(KeyType::ECDH(crypto::ecc_curve::ECCCurve::Curve25519))
            .can_sign(false)
            .can_encrypt(true)
            .passphrase(Some("pass".into()))
            .build()
            .unwrap();
        let params = SecretKeyParamsBuilder::default()
            .version(KeyVersion::V4)
            .key_type(KeyType::Ed25519Legacy)
            .can_sign(true)
            .can_encrypt(false)
            .passphrase(Some("pass".into()))
            .subkeys(vec![signing_sub, encryption_sub])
            .primary_user_id("test <test@example.com>".into())
            .build()
            .unwrap();

        let secret = params.generate(OsRng).unwrap();
        let signed = secret.sign(OsRng, &"pass".into()).unwrap();
        let pub_armored = signed
            .signed_public_key()
            .to_armored_string(ArmorOptions::default())
            .unwrap();

        let pk = PublicKeys::try_from(pub_armored.as_str()).unwrap();
        let key_id = pk.get_signing_sub_key_id().unwrap();
        assert!(!key_id.is_empty());
    }

    /// 署名済みメッセージから検証なしで署名者の鍵IDを抽出できることを確認
    #[test]
    fn extract_key_id_from_signed_message() {
        use pgp::crypto::hash::HashAlgorithm;
        use pgp::types::{Password, PublicKeyTrait};

        let signing_sub = SubkeyParamsBuilder::default()
            .version(KeyVersion::V4)
            .key_type(KeyType::Ed25519Legacy)
            .can_sign(true)
            .can_encrypt(false)
            .passphrase(Some("pass".into()))
            .build()
            .unwrap();
        let encryption_sub = SubkeyParamsBuilder::default()
            .version(KeyVersion::V4)
            .key_type(KeyType::ECDH(crypto::ecc_curve::ECCCurve::Curve25519))
            .can_sign(false)
            .can_encrypt(true)
            .passphrase(Some("pass".into()))
            .build()
            .unwrap();
        let params = SecretKeyParamsBuilder::default()
            .version(KeyVersion::V4)
            .key_type(KeyType::Ed25519Legacy)
            .can_sign(true)
            .can_encrypt(false)
            .passphrase(Some("pass".into()))
            .subkeys(vec![signing_sub, encryption_sub])
            .primary_user_id("test <test@example.com>".into())
            .build()
            .unwrap();

        let secret = params.generate(OsRng).unwrap();
        let signed_key = secret.sign(OsRng, &"pass".into()).unwrap();

        // 署名サブキーの鍵IDを取得
        let signing_subkey = signed_key
            .secret_subkeys
            .iter()
            .find(|k| k.public_key().is_signing_key())
            .expect("signing subkey");
        let expected_key_id = signing_subkey.key_id().to_string();

        // MessageBuilder で署名メッセージを作成
        let mut builder = MessageBuilder::from_bytes("", b"test payload".to_vec());
        builder.compression(CompressionAlgorithm::ZLIB);
        builder.sign(
            &signing_subkey.key,
            Password::from("pass"),
            HashAlgorithm::Sha512,
        );
        let armored = builder
            .to_armored_string(OsRng, ArmorOptions::default())
            .unwrap();

        // extract_issuer_key_id で鍵IDを取得できるか
        let extracted = extract_issuer_key_id(&armored).unwrap();
        assert_eq!(extracted, expected_key_id);

        // verify_and_extract で署名検証とペイロード取得ができるか
        let pub_armored = signed_key
            .signed_public_key()
            .to_armored_string(ArmorOptions::default())
            .unwrap();
        let pk = PublicKeys::try_from(pub_armored.as_str()).unwrap();
        let payload = pk.verify_and_extract(&armored).unwrap();
        assert_eq!(payload, b"test payload");
    }

    /// サブキーで作成された certification 署名も検証できることを確認。
    #[test]
    fn verify_certification_with_signing_subkey() {
        use pgp::packet::{PacketTrait, SignatureConfig, SignatureType, SignatureVersionSpecific};
        use pgp::types::{Password, Tag};

        let make_key = |uid: &str| {
            let signing_sub = SubkeyParamsBuilder::default()
                .version(KeyVersion::V4)
                .key_type(KeyType::Ed25519Legacy)
                .can_sign(true)
                .can_encrypt(false)
                .passphrase(Some("pass".into()))
                .build()
                .unwrap();
            let encryption_sub = SubkeyParamsBuilder::default()
                .version(KeyVersion::V4)
                .key_type(KeyType::ECDH(crypto::ecc_curve::ECCCurve::Curve25519))
                .can_sign(false)
                .can_encrypt(true)
                .passphrase(Some("pass".into()))
                .build()
                .unwrap();
            let params = SecretKeyParamsBuilder::default()
                .version(KeyVersion::V4)
                .key_type(KeyType::Ed25519Legacy)
                .can_sign(true)
                .can_encrypt(false)
                .passphrase(Some("pass".into()))
                .subkeys(vec![signing_sub, encryption_sub])
                .primary_user_id(uid.into())
                .build()
                .unwrap();
            params
                .generate(OsRng)
                .unwrap()
                .sign(OsRng, &"pass".into())
                .unwrap()
        };

        let signer = make_key("signer <signer@example.com>");
        let target = make_key("target <target@example.com>");

        let signer_subkey = signer
            .secret_subkeys
            .iter()
            .find(|k| k.public_key().is_signing_key())
            .expect("signing subkey");
        let target_public = target.signed_public_key();
        let target_uid = target_public.details.users.first().expect("target user id");

        let cfg = SignatureConfig {
            typ: SignatureType::CertGeneric,
            pub_alg: signer_subkey.key.algorithm(),
            hash_alg: pgp::crypto::hash::HashAlgorithm::Sha512,
            hashed_subpackets: vec![],
            unhashed_subpackets: vec![],
            version_specific: SignatureVersionSpecific::V4,
        };
        let sig = cfg
            .sign_certification_third_party(
                &signer_subkey.key,
                &Password::from("pass"),
                &target_public,
                Tag::UserId,
                &target_uid.id,
            )
            .unwrap();
        let mut raw_sig = Vec::new();
        sig.to_writer_with_header(&mut raw_sig).unwrap();

        let signer_public = signer
            .signed_public_key()
            .to_armored_string(ArmorOptions::default())
            .unwrap();
        let target_public_armored = target_public
            .to_armored_string(ArmorOptions::default())
            .unwrap();

        assert!(
            verify_certification_signature_for_target(
                &signer_public,
                &target_public_armored,
                &raw_sig,
            )
            .unwrap()
        );
    }
}
