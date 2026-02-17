type Props = {
  name: string;
  iconUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
};

const sizeClasses = {
  xs: "w-7 h-7 text-xs",
  sm: "w-10 h-10 text-sm",
  md: "w-10 h-10 text-sm",
  lg: "w-16 h-16 text-xl",
};

const Avatar = ({ name, iconUrl, size = "md" }: Props) => {
  const initial = name.charAt(0).toUpperCase() || "?";

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={name}
        className={`${sizeClasses[size]} rounded-full object-cover shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-accent flex items-center justify-center font-bold text-bg shrink-0`}
    >
      {initial}
    </div>
  );
};

export default Avatar;
