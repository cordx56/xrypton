type Props = {
  date: string;
};

const DateSeparator = ({ date }: Props) => (
  <div className="flex items-center my-3 px-4">
    <div className="flex-1 h-px bg-accent/20" />
    <span className="px-3 text-xs text-muted">{date}</span>
    <div className="flex-1 h-px bg-accent/20" />
  </div>
);

export default DateSeparator;
