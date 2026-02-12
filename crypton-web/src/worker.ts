import { z } from "zod";
import init, {
  generate_private_keys,
  export_public_keys,
  get_signing_sub_key_id,
  sign,
  sign_and_encrypt,
  decrypt,
  verify_detached_signature,
  validate_passphrases,
} from "crypton-wasm";
import {
  WasmReturnValue,
  WorkerCallMessage,
  WorkerResultMessage,
} from "@/utils/schema";

// @ts-expect-error Worker is provided by the dedicated worker context at runtime.
const worker: Worker = self;

let initialized = false;

/** 標準base64をbase64urlに変換 */
const toBase64Url = (b64: string): string =>
  b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

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
  } else if (parsed.data.call === "encrypt") {
    const data = Buffer.from(parsed.data.payload, "base64");
    const result = WasmReturnValue.safeParse(
      sign_and_encrypt(
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
      // base64url エンコードされた armored メッセージをデコードして返す
      const decoded = atob(
        result.data.value[0].data.replace(/-/g, "+").replace(/_/g, "/"),
      );
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
    const knownPubKeys = new Map(Object.entries(parsed.data.knownPublicKeys));

    let result;
    try {
      result = WasmReturnValue.safeParse(
        decrypt(
          parsed.data.privateKeys,
          parsed.data.passphrase,
          parsed.data.message,
        ),
      );
    } catch (e) {
      post({
        call: "decrypt",
        result: {
          success: false,
          message: e instanceof Error ? e.message : "decrypt error",
        },
      });
      return;
    }
    if (
      result.success === true &&
      result.data.result === "ok" &&
      result.data.value[0].type === "base64"
    ) {
      if (1 < result.data.value.length) {
        const data = Buffer.from(result.data.value[0].data, "base64");
        const detachedSignature = result.data.value[1].data;
        const keyIds = result.data.value.slice(2);
        for (const keyId of keyIds) {
          const pubKey = knownPubKeys.get(keyId.data);
          if (pubKey === undefined) {
            post({
              call: "decrypt",
              result: {
                success: false,
                message: "unknown sender",
              },
            });
            return;
          }
          const checkResult = WasmReturnValue.safeParse(
            verify_detached_signature(
              pubKey.publicKeys,
              detachedSignature,
              data,
            ),
          );
          if (!checkResult.success) {
            post({
              call: "decrypt",
              result: {
                success: false,
                message: "verification failed",
              },
            });
            return;
          }
        }
        post({
          call: "decrypt",
          result: {
            success: true,
            data: {
              key_ids: keyIds.map((v) => v.data),
              payload: toBase64Url(result.data.value[0].data),
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
              payload: toBase64Url(result.data.value[0].data),
            },
          },
        });
      }
      return;
    }
    post({
      call: "decrypt",
      result: {
        success: false,
        message:
          result.data?.result === "error"
            ? result.data.message
            : "message parse error",
      },
    });
  }
});
