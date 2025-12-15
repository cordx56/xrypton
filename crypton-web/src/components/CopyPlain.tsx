import Code from "@/components/Code";

const CopyPlain = ({ data }: { data: string }) => {
  return (
    <div className="flex flex-col">
      <Code code={data} />
    </div>
  );
};

export default CopyPlain;
