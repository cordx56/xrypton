import { useState } from "react";

const Code = ({ code }: { code: string }) => {
  const [copyMessage, setCopyMessage] = useState("Copy");
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopyMessage("Copied!");
    setTimeout(() => {
      setCopyMessage("Copy");
    }, 3000);
  };

  return (
    <div className="group relative">
      <button
        type="button"
        className="button absolute top-0 right-0 opacity-0 group-hover:opacity-100"
        onClick={copy}
      >
        {copyMessage}
      </button>
      <pre className="overflow-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export default Code;
