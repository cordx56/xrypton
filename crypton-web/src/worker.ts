import { z } from "zod";
import init, {
  generate_private_keys,
  export_public_keys,
  encrypt,
  decrypt,
} from "crypton-wasm";
import {
  WorkerCallMessage,
  WasmReturnValue,
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
            keys: result.data.value.data,
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
            keys: result.data.value.data,
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
    const result = WasmReturnValue.safeParse(encrypt(parsed.data.keys, data));
    if (
      result.success === true &&
      result.data.result === "ok" &&
      result.data.value &&
      result.data.value.type === "string"
    ) {
      post({
        call: "encrypt",
        result: {
          success: true,
          data: {
            message: result.data.value.data,
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
    const result = WasmReturnValue.safeParse(
      decrypt(parsed.data.keys, parsed.data.passPhrase, parsed.data.message),
    );
    if (
      result.success === true &&
      result.data.result === "ok" &&
      result.data.value?.type === "base64"
    ) {
      post({
        call: "decrypt",
        result: {
          success: true,
          data: {
            payload: result.data.value.data,
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
  }
});
