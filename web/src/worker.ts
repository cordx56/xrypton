import { z } from "zod";
import init, {
  generate_private_keys,
  export_public_keys,
  get_signing_sub_key_id,
  get_primary_fingerprint,
  get_private_key_user_ids,
  sign,
  sign_bytes,
  sign_encrypt_sign,
  sign_encrypt_sign_bin,
  decrypt,
  unwrap_outer,
  unwrap_outer_bytes,
  decrypt_bytes,
  extract_key_id,
  extract_key_id_bytes,
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
  } else if (parsed.data.call === "get_key_id") {
    const result = WasmReturnValue.safeParse(
      get_signing_sub_key_id(parsed.data.publicKeys),
    );
    if (
      result.success &&
      result.data.result === "ok" &&
      result.data.value[0].type === "string"
    ) {
      post({
        call: "get_key_id",
        result: { success: true, data: { key_id: result.data.value[0].data } },
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
    // 1. extract_key_id で outer signer key ID を取得
    // 2. knownPublicKeys から送信者の公開鍵を取得
    // 3. unwrap_outer で外側署名検証 + inner encrypted bytes 取得
    // 4. decrypt_bytes で inner を復号 + inner signer key IDs 取得
    // 5. outer key ID ∈ inner key IDs を確認
    // 6. detached signature 検証
    const knownPubKeys = new Map(Object.entries(parsed.data.knownPublicKeys));

    try {
      // 1. outer signer key ID を取得
      const keyIdResult = WasmReturnValue.safeParse(
        extract_key_id(parsed.data.message),
      );
      if (
        !keyIdResult.success ||
        keyIdResult.data.result !== "ok" ||
        keyIdResult.data.value[0]?.type !== "string"
      ) {
        post({
          call: "decrypt",
          result: { success: false, message: "failed to extract outer key id" },
        });
        return;
      }
      const outerKeyId = keyIdResult.data.value[0].data;

      // 2. 送信者の公開鍵を取得
      const senderPubKey = knownPubKeys.get(outerKeyId);
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
        const innerKeyIds = innerResult.data.value.slice(2).map((v) => v.data);

        // outer key ID が inner key IDs に含まれるか確認
        if (!innerKeyIds.includes(outerKeyId)) {
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
              key_ids: innerKeyIds,
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
              key_ids: [],
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
  } else if (parsed.data.call === "extract_key_id") {
    try {
      const result = WasmReturnValue.safeParse(
        extract_key_id(parsed.data.armored),
      );
      if (
        result.success &&
        result.data.result === "ok" &&
        result.data.value[0]?.type === "string"
      ) {
        post({
          call: "extract_key_id",
          result: {
            success: true,
            data: { key_id: result.data.value[0].data },
          },
        });
      } else {
        post({
          call: "extract_key_id",
          result: {
            success: false,
            message:
              result.data?.result === "error"
                ? result.data.message
                : "extract key id error",
          },
        });
      }
    } catch (e) {
      post({
        call: "extract_key_id",
        result: {
          success: false,
          message: e instanceof Error ? e.message : "extract key id error",
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
              outerKeyId: result.data.value[1].data,
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
    // 1. extract_key_id_bytes で outer signer key ID を取得
    // 2. knownPublicKeys から送信者の公開鍵を取得
    // 3. unwrap_outer_bytes で外側署名検証 + inner encrypted bytes 取得
    // 4. decrypt_bytes で inner を復号 + inner signer key IDs 取得
    // 5. outer key ID ∈ inner key IDs を確認
    // 6. detached signature 検証
    const knownPubKeys = new Map(Object.entries(parsed.data.knownPublicKeys));

    try {
      const rawData = Buffer.from(parsed.data.data, "base64");

      // 1. outer signer key ID を取得
      const keyIdResult = WasmReturnValue.safeParse(
        extract_key_id_bytes(rawData),
      );
      if (
        !keyIdResult.success ||
        keyIdResult.data.result !== "ok" ||
        keyIdResult.data.value[0]?.type !== "string"
      ) {
        post({
          call: "decrypt_bin",
          result: { success: false, message: "failed to extract outer key id" },
        });
        return;
      }
      const outerKeyId = keyIdResult.data.value[0].data;

      // 2. 送信者の公開鍵を取得
      const senderPubKey = knownPubKeys.get(outerKeyId);
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
        const innerKeyIds = innerResult.data.value.slice(2).map((v) => v.data);

        if (!innerKeyIds.includes(outerKeyId)) {
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
              key_ids: innerKeyIds,
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
              key_ids: [],
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
        const keyIds =
          result.data.value.length > 1
            ? result.data.value.slice(2).map((v) => v.data)
            : [];
        post({
          call: "decrypt_bytes",
          result: {
            success: true,
            data: {
              key_ids: keyIds,
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
              keyId: result.data.value[1].data,
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
