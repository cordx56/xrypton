"use client";

import { useContexts } from "@/utils/context";
import CommonDialog from "@/components/Dialogs/CommonDialog";
import GenerateKey from "@/components/GenerateKey";
import QrDisplay from "@/components/QrDisplay";
import Encrypt from "@/components/Encrypt";
import Decrypt from "@/components/Decrypt";

export default function Home() {
  const { dialogs, publicKeys } = useContexts();

  return (
    <>
      <div className="centered">
        <div className="flex flex-col md:flex-row">
          <div className="flex flex-col w-full md:w-1/2">
            {publicKeys?.keys ? <QrDisplay data={publicKeys.keys} /> : null}
            <div className="flex flex-col md:flex-row justify-center text-xl">
              <button
                type="button"
                className="button"
                onClick={() => {
                  dialogs?.pushDialog((p) => (
                    <CommonDialog {...p}>
                      <Encrypt />
                    </CommonDialog>
                  ));
                }}
              >
                Encrypt
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  dialogs?.pushDialog((p) => (
                    <CommonDialog {...p}>
                      <Decrypt />
                    </CommonDialog>
                  ));
                }}
              >
                Decrypt
              </button>
            </div>
          </div>
          <div className="w-full md:w-1/2">
            <button
              className="button"
              onClick={() =>
                dialogs?.pushDialog((p) => (
                  <CommonDialog {...p}>
                    <GenerateKey />
                  </CommonDialog>
                ))
              }
            >
              Generate Keys
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
