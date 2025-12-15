const CopyPlain = ({ data }: { data: string }) => {
  const copy = async () => {
    await navigator.clipboard.writeText(data);
  };
  return (
    <div className="flex flex-col">
      <pre>
        <code>{data}</code>
      </pre>
      <div>
        <button type="button" className="button" onClick={copy}>
          Copy
        </button>
      </div>
    </div>
  );
};

export default CopyPlain;
