import { z } from "zod";
import init, {
  generate_and_save_private_keys,
  export_public_keys,
} from "crypton-wasm";
import {
  WorkerCallMessage,
  WasmReturnValue,
  WorkerResultMessage,
} from "@/utils/schema";

// @ts-expect-error Worker is provided by the dedicated worker context at runtime.
const worker: Worker = self;

worker.addEventListener("message", async ({ data }) => {
  console.log("worker received", data);

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
  } else if (parsed.data.call === "generate") {
    const result = WasmReturnValue.safeParse(
      generate_and_save_private_keys(
        parsed.data.userId,
        parsed.data.mainPassphrase,
        parsed.data.subPassphrase,
      ),
    );
    if (result.success === true && result.data.result === "ok") {
      if (
        result.success === true &&
        result.data.result === "ok" &&
        result.data.value
      ) {
        worker.postMessage({
          call: "generate",
          result: {
            success: true,
            data: {
              keys: result.data.value.data,
            },
          },
        } as z.infer<typeof WorkerResultMessage>);
      }
    } else {
      worker.postMessage({
        call: "generate",
        success: false,
        message:
          result.data?.result === "error"
            ? result.data.message
            : "message parse error",
      });
    }
  } else if (parsed.data.call === "export_public_keys") {
    const result = WasmReturnValue.safeParse(
      export_public_keys(parsed.data.keys),
    );
    if (result.success === false) {
      worker.postMessage({
        call: "export_public_keys",
        success: false,
        message: "message parse error",
      });
      return;
    }
    if (result.data.result === "error") {
      worker.postMessage({
        call: "export_public_keys",
        success: false,
        message: result.data.message,
      });
      return;
    }
    worker.postMessage({
      call: "export_public_keys",
      success: true,
      data: {
        keys: result.data.value?.data,
      },
    });
  }
});
