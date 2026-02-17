type Props = {
  message: string;
  fading: boolean;
  onDismiss: () => void;
};

const ErrorToast = ({ message, fading, onDismiss }: Props) => {
  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[min(24rem,calc(100%-2rem))] cursor-pointer ${fading ? "animate-fade-out" : "animate-slide-down"}`}
      onClick={onDismiss}
    >
      <div className="flex items-center gap-3 rounded-xl border border-red-500/40 bg-bg/95 backdrop-blur-sm px-4 py-3 shadow-lg">
        <div className="text-red-400 text-lg flex-shrink-0">!</div>
        <div className="min-w-0 flex-1 text-sm">{message}</div>
      </div>
    </div>
  );
};

export default ErrorToast;
