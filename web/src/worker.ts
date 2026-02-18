import { z } from "zod";
import init, {
  generate_private_keys,
  export_public_keys,
  get_primary_fingerprint,
  get_signing_sub_key_fingerprint,
  get_private_key_user_ids,
  sign,
  sign_bytes,
  sign_detached,
  certify_key_bytes,
  sign_encrypt_sign,
  sign_encrypt_sign_bin,
  unwrap_outer,
  unwrap_outer_bytes,
  decrypt_bytes,
  extract_fingerprint,
  extract_fingerprint_bytes,
  verify_detached_signature,
  verify_extract_string,
  extract_and_verify_string,
  validate_passphrases,
} from "xrypton-wasm";
import {
  WasmReturnValue,
  WorkerCallMessage,
  WorkerResultMessage,
} from "@/utils/schema";
import { base64ToBase64Url, decodeBase64Url } from "@/utils/base64";

// @ts-expect-error Worker is provided by the dedicated worker context at runtime.
const worker: Worker = self;

let initialized = false;

/** knownPublicKeys マップから、主鍵フィンガープリントと署名サブキーフィンガープリント
 *  の両方でルックアップ可能なマップを構築する。
 *  extract_fingerprint が返す issuer fingerprint は署名サブキーのものであるため、
 *  主鍵フィンガープリントだけでは検索に失敗する。 */
function buildPubKeyLookup(
  knownPublicKeys: Record<string, { name: string; publicKeys: string }>,
): Map<string, { name: string; publicKeys: string }> {
  const map = new Map(Object.entries(knownPublicKeys));
  for (const [, entry] of Object.entries(knownPublicKeys)) {
    try {
      const result = WasmReturnValue.safeParse(
        get_signing_sub_key_fingerprint(entry.publicKeys),
      );
      if (
        result.success &&
        result.data.result === "ok" &&
        result.data.value[0]?.type === "string"
      ) {
        map.set(result.data.value[0].data, entry);
      }
    } catch {
      // 署名サブキーのフィンガープリント取得に失敗した場合はスキップ
    }
  }
  return map;
}

worker.addEventListener("message", async ({ data }) => {
  const post = (msg: z.infer<typeof WorkerResultMessage>) =>
    worker.postMessage(msg);

  const parsed = WorkerCallMessage.safeParse(data);
  if (!parsed.success) {
    return;
  }

  if (parsed.data.call === "init") {
    if (parsed.data.wasmUrl) {
      await init(parsed.data.wasmUrl);
    } else {
      await init();
    }
    initialized = true;
    return;
  }
  while (!initialized) {
    const wait = (ms: number) => {
      return new Promise((resolve) => setTimeout(resolve, ms));
    };
    await wait(500);
  }
  if (parsed.data.call === "generate") {
    const result = WasmReturnValue.safeParse(
      generate_private_keys(
        parsed.data.userId,
        parsed.data.mainPassphrase,
        parsed.data.subPassphrase,
      ),
    );
    if (
      result.success === true &&
      result.data.result === "ok" &&
      result.data.value
    ) {
      post({
        call: "generate",
        result: {
          success: true,
          data: {
            keys: result.data.value[0].data,
          },
        },
      } as z.infer<typeof WorkerResultMessage>);
    } else {
      post({
        call: "generate",
        result: {
          success: false,
          message:
            result.data?.result === "error"
              ? result.data.message
              : "message parse error",
        },
      });
    }
  } else if (parsed.data.call === "export_public_keys") {
    const result = WasmReturnValue.safeParse(
      export_public_keys(parsed.data.keys),
    );
    if (
      result.success === true &&
      result.data.result === "ok" &&
      result.data.value
    ) {
      post({
        call: "export_public_keys",
        result: {
          success: true,
          data: {
            keys: result.data.value[0].data,
          },
        },
      } as z.infer<typeof WorkerResultMessage>);
    } else {
      post({
        call: "export_public_keys",
        result: {
          success: false,
          message:
            result.data?.result === "error"
              ? result.data.message
              : "message parse error",
        },
      });
    }
  } else if (parsed.data.call === "get_primary_fingerprint") {
    const result = WasmReturnValue.safeParse(
      get_primary_fingerprint(parsed.data.publicKeys),
    );
    if (
      result.success &&
      result.data.result === "ok" &&
      result.data.value[0].type === "string"
    ) {
      post({
        call: "get_primary_fingerprint",
        result: {
          success: true,
          data: { fingerprint: result.data.value[0].data },
        },
      });
    }
  } else if (parsed.data.call === "encrypt") {
    const data = Buffer.from(parsed.data.payload, "base64");
    const result = WasmReturnValue.safeParse(
      sign_encrypt_sign(
        parsed.data.privateKeys,
        parsed.data.publicKeys,
        parsed.data.passphrase,
        data,
      ),
    );
    if (
      result.success === true &&
      result.data.result === "ok" &&
      result.data.value &&
      result.data.value[0].type === "string"
    ) {
      post({
        call: "encrypt",
        result: {
          success: true,
          data: {
            message: result.data.value[0].data,
          },
        },
      } as z.infer<typeof WorkerResultMessage>);
    } else {
      post({
        call: "encrypt",
        result: {
          success: false,
          message:
            result.data?.result === "error"
              ? result.data.message
              : "message parse error",
        },
      });
    }
  } else if (parsed.data.call === "encrypt_bin") {
    const data = Buffer.from(parsed.data.payload, "base64");
    const result = WasmReturnValue.safeParse(
      sign_encrypt_sign_bin(
        parsed.data.privateKeys,
        parsed.data.publicKeys,
        parsed.data.passphrase,
        data,
      ),
    );
    if (
      result.success === true &&
      result.data.result === "ok" &&
      result.data.value &&
      result.data.value[0].type === "base64"
    ) {
      post({
        call: "encrypt_bin",
        result: {
          success: true,
          data: {
            data: result.data.value[0].data,
          },
        },
      } as z.infer<typeof WorkerResultMessage>);
    } else {
      post({
        call: "encrypt_bin",
        result: {
          success: false,
          message:
            result.data?.result === "error"
              ? result.data.message
              : "message parse error",
        },
      });
    }
  } else if (parsed.data.call === "sign") {
    const payload = new TextEncoder().encode(parsed.data.payload);
    const result = WasmReturnValue.safeParse(
      sign(parsed.data.keys, parsed.data.passphrase, payload),
    );
    if (
      result.success === true &&
      result.data.result === "ok" &&
      result.data.value[0].type === "base64"
    ) {
      // base64urlエンコードされたarmoredメッセージをデコードして返す
      const decoded = decodeBase64Url(result.data.value[0].data);
      post({
        call: "sign",
        result: {
          success: true,
          data: { signed_message: decoded },
        },
      });
    } else {
      post({
        call: "sign",
        result: {
          success: false,
          message:
            result.data?.result === "error"
              ? result.data.message
              : "sign error",
        },
      });
    }
  } else if (parsed.data.call === "sign_bytes") {
    const payload = Buffer.from(parsed.data.payload, "base64");
    const result = WasmReturnValue.safeParse(
      sign_bytes(parsed.data.keys, parsed.data.passphrase, payload),
    );
    if (
      result.success === true &&
      result.data.result === "ok" &&
      result.data.value[0].type === "base64"
    ) {
      post({
        call: "sign_bytes",
        result: {
          success: true,
          data: { data: result.data.value[0].data },
        },
      });
    } else {
      post({
        call: "sign_bytes",
        result: {
          success: false,
          message:
            result.data?.result === "error"
              ? result.data.message
              : "sign_bytes error",
        },
      });
    }
  } else if (parsed.data.call === "sign_detached") {
    const payload = Buffer.from(parsed.data.payload, "base64");
    const result = WasmReturnValue.safeParse(
      sign_detached(parsed.data.keys, parsed.data.passphrase, payload),
    );
    if (
      result.success === true &&
      result.data.result === "ok" &&
      result.data.value[0].type === "string"
    ) {
      post({
        call: "sign_detached",
        result: {
          success: true,
          data: { signature: result.data.value[0].data },
        },
      });
    } else {
      post({
        call: "sign_detached",
        result: {
          success: false,
          message:
            result.data?.result === "error"
              ? result.data.message
              : "sign_detached error",
        },
      });
    }
  } else if (parsed.data.call === "certify_key_bytes") {
    const result = WasmReturnValue.safeParse(
      certify_key_bytes(
        parsed.data.privateKey,
        parsed.data.targetPublicKey,
        parsed.data.passphrase,
      ),
    );
    if (
      result.success === true &&
      result.data.result === "ok" &&
      result.data.value[0].type === "base64"
    ) {
      post({
        call: "certify_key_bytes",
        result: {
          success: true,
          data: { data: result.data.value[0].data },
        },
      });
    } else {
      post({
        call: "certify_key_bytes",
        result: {
          success: false,
          message:
            result.data?.result === "error"
              ? result.data.message
              : "certify key error",
        },
      });
    }
  } else if (parsed.data.call === "verify_detached_signature") {
    const payload = Buffer.from(parsed.data.data, "base64");
    const result = WasmReturnValue.safeParse(
      verify_detached_signature(
        parsed.data.publicKey,
        parsed.data.signature,
        payload,
      ),
    );
    if (result.success && result.data.result === "ok") {
      post({
        call: "verify_detached_signature",
        result: { success: true, data: {} },
      });
    } else {
      post({
        call: "verify_detached_signature",
        result: {
          success: false,
          message:
            result.data?.result === "error"
              ? result.data.message
              : "verify detached signature error",
        },
      });
    }
  } else if (parsed.data.call === "validate_passphrases") {
    try {
      const result = WasmReturnValue.safeParse(
        validate_passphrases(
          parsed.data.privateKeys,
          parsed.data.mainPassphrase,
          parsed.data.subPassphrase,
        ),
      );
      if (result.success && result.data.result === "ok") {
        post({
          call: "validate_passphrases",
          result: { success: true, data: {} },
        });
      } else {
        post({
          call: "validate_passphrases",
          result: {
            success: false,
            message:
              result.data?.result === "error"
                ? result.data.message
                : "validation error",
          },
        });
      }
    } catch (e) {
      post({
        call: "validate_passphrases",
        result: {
          success: false,
          message: e instanceof Error ? e.message : "validation error",
        },
      });
    }
  } else if (parsed.data.call === "decrypt") {
    // sign_encrypt_sign 形式: Signed(Encrypted(Signed(Data)))
    // 1. extract_fingerprint で outer signer fingerprint を取得
    // 2. knownPublicKeys から送信者の公開鍵を取得
    // 3. unwrap_outer で外側署名検証 + inner encrypted bytes 取得
    // 4. decrypt_bytes で inner を復号 + inner signer fingerprints 取得
    // 5. outer fingerprint ∈ inner fingerprints を確認
    // 6. detached signature 検証
    const knownPubKeys = buildPubKeyLookup(parsed.data.knownPublicKeys);

    try {
      // 1. outer signer fingerprint を取得
      const fingerprintResult = WasmReturnValue.safeParse(
        extract_fingerprint(parsed.data.message),
      );
      if (
        !fingerprintResult.success ||
        fingerprintResult.data.result !== "ok" ||
        fingerprintResult.data.value[0]?.type !== "string"
      ) {
        post({
          call: "decrypt",
          result: {
            success: false,
            message: "failed to extract outer fingerprint",
          },
        });
        return;
      }
      const outerFingerprint = fingerprintResult.data.value[0].data;

      // 2. 送信者の公開鍵を取得
      const senderPubKey = knownPubKeys.get(outerFingerprint);
      if (!senderPubKey) {
        post({
          call: "decrypt",
          result: { success: false, message: "unknown sender" },
        });
        return;
      }

      // 3. 外側署名検証 + inner bytes 取得
      const outerResult = WasmReturnValue.safeParse(
        unwrap_outer(senderPubKey.publicKeys, parsed.data.message),
      );
      if (
        !outerResult.success ||
        outerResult.data.result !== "ok" ||
        outerResult.data.value[0]?.type !== "base64"
      ) {
        post({
          call: "decrypt",
          result: {
            success: false,
            message:
              outerResult.data?.result === "error"
                ? outerResult.data.message
                : "outer signature verification failed",
          },
        });
        return;
      }
      const innerBytes = Buffer.from(outerResult.data.value[0].data, "base64");

      // 4. inner encrypted bytes を復号
      const innerResult = WasmReturnValue.safeParse(
        decrypt_bytes(
          parsed.data.privateKeys,
          parsed.data.passphrase,
          innerBytes,
        ),
      );
      if (
        !innerResult.success ||
        innerResult.data.result !== "ok" ||
        innerResult.data.value[0]?.type !== "base64"
      ) {
        post({
          call: "decrypt",
          result: {
            success: false,
            message:
              innerResult.data?.result === "error"
                ? innerResult.data.message
                : "inner decryption failed",
          },
        });
        return;
      }

      // 5 & 6. inner signer 検証
      if (innerResult.data.value.length > 1) {
        const plainData = Buffer.from(innerResult.data.value[0].data, "base64");
        const detachedSignature = innerResult.data.value[1].data;
        const innerFingerprints = innerResult.data.value
          .slice(2)
          .map((v) => v.data);

        // outer fingerprint が inner fingerprints に含まれるか確認
        if (!innerFingerprints.includes(outerFingerprint)) {
          post({
            call: "decrypt",
            result: {
              success: false,
              message: "outer signer not found in inner signers",
            },
          });
          return;
        }

        // detached signature 検証
        const checkResult = WasmReturnValue.safeParse(
          verify_detached_signature(
            senderPubKey.publicKeys,
            detachedSignature,
            plainData,
          ),
        );
        if (!checkResult.success || checkResult.data.result !== "ok") {
          post({
            call: "decrypt",
            result: {
              success: false,
              message: "inner signature verification failed",
            },
          });
          return;
        }

        post({
          call: "decrypt",
          result: {
            success: true,
            data: {
              fingerprints: innerFingerprints,
              payload: base64ToBase64Url(innerResult.data.value[0].data),
            },
          },
        });
      } else {
        post({
          call: "decrypt",
          result: {
            success: true,
            data: {
              fingerprints: [],
              payload: base64ToBase64Url(innerResult.data.value[0].data),
            },
          },
        });
      }
    } catch (e) {
      post({
        call: "decrypt",
        result: {
          success: false,
          message: e instanceof Error ? e.message : "decrypt error",
        },
      });
    }
  } else if (parsed.data.call === "extract_fingerprint") {
    try {
      const result = WasmReturnValue.safeParse(
        extract_fingerprint(parsed.data.armored),
      );
      if (
        result.success &&
        result.data.result === "ok" &&
        result.data.value[0]?.type === "string"
      ) {
        post({
          call: "extract_fingerprint",
          result: {
            success: true,
            data: { fingerprint: result.data.value[0].data },
          },
        });
      } else {
        post({
          call: "extract_fingerprint",
          result: {
            success: false,
            message:
              result.data?.result === "error"
                ? result.data.message
                : "extract fingerprint error",
          },
        });
      }
    } catch (e) {
      post({
        call: "extract_fingerprint",
        result: {
          success: false,
          message: e instanceof Error ? e.message : "extract fingerprint error",
        },
      });
    }
  } else if (parsed.data.call === "unwrap_outer") {
    try {
      const result = WasmReturnValue.safeParse(
        unwrap_outer(parsed.data.publicKey, parsed.data.outerArmored),
      );
      if (
        result.success &&
        result.data.result === "ok" &&
        result.data.value.length >= 2 &&
        result.data.value[0].type === "base64" &&
        result.data.value[1].type === "string"
      ) {
        post({
          call: "unwrap_outer",
          result: {
            success: true,
            data: {
              innerBytes: result.data.value[0].data,
              outerFingerprint: result.data.value[1].data,
            },
          },
        });
      } else {
        post({
          call: "unwrap_outer",
          result: {
            success: false,
            message:
              result.data?.result === "error"
                ? result.data.message
                : "unwrap outer error",
          },
        });
      }
    } catch (e) {
      post({
        call: "unwrap_outer",
        result: {
          success: false,
          message: e instanceof Error ? e.message : "unwrap outer error",
        },
      });
    }
  } else if (parsed.data.call === "decrypt_bin") {
    // sign_encrypt_sign_bin 形式のバイナリデータを完全に復号する
    // 1. extract_fingerprint_bytes で outer signer fingerprint を取得
    // 2. knownPublicKeys から送信者の公開鍵を取得
    // 3. unwrap_outer_bytes で外側署名検証 + inner encrypted bytes 取得
    // 4. decrypt_bytes で inner を復号 + inner signer fingerprints 取得
    // 5. outer fingerprint ∈ inner fingerprints を確認
    // 6. detached signature 検証
    const knownPubKeys = buildPubKeyLookup(parsed.data.knownPublicKeys);

    try {
      const rawData = Buffer.from(parsed.data.data, "base64");

      // 1. outer signer fingerprint を取得
      const fingerprintResult = WasmReturnValue.safeParse(
        extract_fingerprint_bytes(rawData),
      );
      if (
        !fingerprintResult.success ||
        fingerprintResult.data.result !== "ok" ||
        fingerprintResult.data.value[0]?.type !== "string"
      ) {
        post({
          call: "decrypt_bin",
          result: {
            success: false,
            message: "failed to extract outer fingerprint",
          },
        });
        return;
      }
      const outerFingerprint = fingerprintResult.data.value[0].data;

      // 2. 送信者の公開鍵を取得
      const senderPubKey = knownPubKeys.get(outerFingerprint);
      if (!senderPubKey) {
        post({
          call: "decrypt_bin",
          result: { success: false, message: "unknown sender" },
        });
        return;
      }

      // 3. 外側署名検証 + inner bytes 取得
      const outerResult = WasmReturnValue.safeParse(
        unwrap_outer_bytes(senderPubKey.publicKeys, rawData),
      );
      if (
        !outerResult.success ||
        outerResult.data.result !== "ok" ||
        outerResult.data.value[0]?.type !== "base64"
      ) {
        post({
          call: "decrypt_bin",
          result: {
            success: false,
            message:
              outerResult.data?.result === "error"
                ? outerResult.data.message
                : "outer signature verification failed",
          },
        });
        return;
      }
      const innerBytes = Buffer.from(outerResult.data.value[0].data, "base64");

      // 4. inner encrypted bytes を復号
      const innerResult = WasmReturnValue.safeParse(
        decrypt_bytes(
          parsed.data.privateKeys,
          parsed.data.passphrase,
          innerBytes,
        ),
      );
      if (
        !innerResult.success ||
        innerResult.data.result !== "ok" ||
        innerResult.data.value[0]?.type !== "base64"
      ) {
        post({
          call: "decrypt_bin",
          result: {
            success: false,
            message:
              innerResult.data?.result === "error"
                ? innerResult.data.message
                : "inner decryption failed",
          },
        });
        return;
      }

      // 5 & 6. inner signer 検証
      if (innerResult.data.value.length > 1) {
        const plainData = Buffer.from(innerResult.data.value[0].data, "base64");
        const detachedSignature = innerResult.data.value[1].data;
        const innerFingerprints = innerResult.data.value
          .slice(2)
          .map((v) => v.data);

        if (!innerFingerprints.includes(outerFingerprint)) {
          post({
            call: "decrypt_bin",
            result: {
              success: false,
              message: "outer signer not found in inner signers",
            },
          });
          return;
        }

        const checkResult = WasmReturnValue.safeParse(
          verify_detached_signature(
            senderPubKey.publicKeys,
            detachedSignature,
            plainData,
          ),
        );
        if (!checkResult.success || checkResult.data.result !== "ok") {
          post({
            call: "decrypt_bin",
            result: {
              success: false,
              message: "inner signature verification failed",
            },
          });
          return;
        }

        post({
          call: "decrypt_bin",
          result: {
            success: true,
            data: {
              fingerprints: innerFingerprints,
              payload: base64ToBase64Url(innerResult.data.value[0].data),
            },
          },
        });
      } else {
        post({
          call: "decrypt_bin",
          result: {
            success: true,
            data: {
              fingerprints: [],
              payload: base64ToBase64Url(innerResult.data.value[0].data),
            },
          },
        });
      }
    } catch (e) {
      post({
        call: "decrypt_bin",
        result: {
          success: false,
          message: e instanceof Error ? e.message : "decrypt bin error",
        },
      });
    }
  } else if (parsed.data.call === "decrypt_bytes") {
    try {
      const data = Buffer.from(parsed.data.data, "base64");
      const result = WasmReturnValue.safeParse(
        decrypt_bytes(parsed.data.privateKeys, parsed.data.passphrase, data),
      );
      if (
        result.success &&
        result.data.result === "ok" &&
        result.data.value[0]?.type === "base64"
      ) {
        const fingerprints =
          result.data.value.length > 1
            ? result.data.value.slice(2).map((v) => v.data)
            : [];
        post({
          call: "decrypt_bytes",
          result: {
            success: true,
            data: {
              fingerprints,
              payload: base64ToBase64Url(result.data.value[0].data),
            },
          },
        });
      } else {
        post({
          call: "decrypt_bytes",
          result: {
            success: false,
            message:
              result.data?.result === "error"
                ? result.data.message
                : "decrypt bytes error",
          },
        });
      }
    } catch (e) {
      post({
        call: "decrypt_bytes",
        result: {
          success: false,
          message: e instanceof Error ? e.message : "decrypt bytes error",
        },
      });
    }
  } else if (parsed.data.call === "get_private_key_user_ids") {
    try {
      const result = WasmReturnValue.safeParse(
        get_private_key_user_ids(parsed.data.privateKeys),
      );
      if (result.success && result.data.result === "ok") {
        const userIds = result.data.value.map((v) => v.data);
        post({
          call: "get_private_key_user_ids",
          result: { success: true, data: { user_ids: userIds } },
        });
      } else {
        post({
          call: "get_private_key_user_ids",
          result: {
            success: false,
            message:
              result.data?.result === "error"
                ? result.data.message
                : "get user ids error",
          },
        });
      }
    } catch (e) {
      post({
        call: "get_private_key_user_ids",
        result: {
          success: false,
          message: e instanceof Error ? e.message : "get user ids error",
        },
      });
    }
  } else if (parsed.data.call === "verify_extract_string") {
    try {
      const result = WasmReturnValue.safeParse(
        verify_extract_string(parsed.data.publicKey, parsed.data.armored),
      );
      if (
        result.success &&
        result.data.result === "ok" &&
        result.data.value[0]?.type === "string"
      ) {
        post({
          call: "verify_extract_string",
          result: {
            success: true,
            data: { plaintext: result.data.value[0].data },
          },
        });
      } else {
        post({
          call: "verify_extract_string",
          result: {
            success: false,
            message:
              result.data?.result === "error"
                ? result.data.message
                : "verify extract error",
          },
        });
      }
    } catch (e) {
      post({
        call: "verify_extract_string",
        result: {
          success: false,
          message: e instanceof Error ? e.message : "verify extract error",
        },
      });
    }
  } else if (parsed.data.call === "extract_and_verify_string") {
    try {
      const result = WasmReturnValue.safeParse(
        extract_and_verify_string(parsed.data.publicKey, parsed.data.armored),
      );
      if (
        result.success &&
        result.data.result === "ok" &&
        result.data.value[0]?.type === "string" &&
        result.data.value[1]?.type === "string"
      ) {
        post({
          call: "extract_and_verify_string",
          result: {
            success: true,
            data: {
              plaintext: result.data.value[0].data,
              verified: result.data.value[1].data === "true",
            },
          },
        });
      } else {
        post({
          call: "extract_and_verify_string",
          result: {
            success: false,
            message:
              result.data?.result === "error"
                ? result.data.message
                : "extract and verify error",
          },
        });
      }
    } catch (e) {
      post({
        call: "extract_and_verify_string",
        result: {
          success: false,
          message: e instanceof Error ? e.message : "extract and verify error",
        },
      });
    }
  } else if (parsed.data.call === "verify_extract_bytes") {
    try {
      const rawData = Buffer.from(parsed.data.data, "base64");
      const result = WasmReturnValue.safeParse(
        unwrap_outer_bytes(parsed.data.publicKey, rawData),
      );
      if (
        result.success &&
        result.data.result === "ok" &&
        result.data.value.length >= 2 &&
        result.data.value[0].type === "base64" &&
        result.data.value[1].type === "string"
      ) {
        post({
          call: "verify_extract_bytes",
          result: {
            success: true,
            data: {
              data: result.data.value[0].data,
              fingerprint: result.data.value[1].data,
            },
          },
        });
      } else {
        post({
          call: "verify_extract_bytes",
          result: {
            success: false,
            message:
              result.data?.result === "error"
                ? result.data.message
                : "verify extract bytes error",
          },
        });
      }
    } catch (e) {
      post({
        call: "verify_extract_bytes",
        result: {
          success: false,
          message:
            e instanceof Error ? e.message : "verify extract bytes error",
        },
      });
    }
  }
});
