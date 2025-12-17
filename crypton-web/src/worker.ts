import { z } from "zod";
import init, {
  generate_private_keys,
  export_public_keys,
  sign_and_encrypt,
  decrypt,
  verify,
} from "crypton-wasm";
import { WasmReturnValue } from "crypton-common";
import {
  WorkerCallMessage,
  WorkerResultMessage,
} from "@/utils/schema";

// @ts-expect-error Worker is provided by the dedicated worker context at runtime.
const worker: Worker = self;

let initialized = false;

worker.addEventListener("message", async ({ data }) => {
  console.log("worker received", data);
  const post = (msg: z.infer<typeof WorkerResultMessage>) =>
    worker.postMessage(msg);

  const parsed = WorkerCallMessage.safeParse(data);
  if (!parsed.success) {
    console.log("invalid message:", parsed.error);
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
  } else if (parsed.data.call === "encrypt") {
    const data = Buffer.from(parsed.data.payload, "base64");
    const result = WasmReturnValue.safeParse(sign_and_encrypt(parsed.data.privateKeys, parsed.data.publicKeys, parsed.data.passphrase, data));
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
  } else if (parsed.data.call === "decrypt") {
    const knownPubKeys = parsed.data.knownPublicKeys;

    const result = WasmReturnValue.safeParse(
      decrypt(parsed.data.privateKeys, parsed.data.passphrase, parsed.data.message),
    );
    if (
      result.success === true &&
      result.data.result === "ok") {
      if (
        result.data.value[0].type === "string" &&
        result.data.value[0].data.length !== 0 &&
        result.data.value[1].type === "base64" &&
        Object.keys(knownPubKeys).includes(result.data.value[0].data)
      ) {
        const checkResult = WasmReturnValue.safeParse(verify(knownPubKeys[result.data.value[0].data], result.data.value[1].data));
        if (checkResult.success) {
          post({
            call: "decrypt",
            result: {
              success: true,
              data: {
                sender: result.data.value[0].data,
                payload: result.data.value[1].data,
              },
            },
          });
        } else {
          post({
            call: "decrypt",
            result: {
              success: false,
              message: "verification failed",
            },
          });
        }
        return;
      } else {
        post({
          call: "decrypt",
          result: {
            success: true,
            data: {
              sender: result.data.value[0].data,
              payload: result.data.value[1].data,
            },
          },
        });
        return;
      }
    }
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
});
