import Image from "next/image";
import { getAvatar } from "@/lib/avatars";
import { clsx } from "@/lib/utils";

const SIZE = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
  "2xl": 112,
  "3xl": 144,
} as const;

export type AvatarSize = keyof typeof SIZE;

export function AvatarImage({
  avatar,
  size = "md",
  className,
  alt,
  rounded = "full",
}: {
  avatar: string;
  size?: AvatarSize;
  className?: string;
  alt?: string;
  rounded?: "full" | "2xl" | "xl";
}) {
  const def = getAvatar(avatar);
  const px = SIZE[size];
  const roundClass =
    rounded === "full"
      ? "rounded-full"
      : rounded === "2xl"
        ? "rounded-2xl"
        : "rounded-xl";

  if (!def) {
    return (
      <span
        className={clsx(
          "inline-grid shrink-0 place-items-center overflow-hidden bg-bg-elevated ring-2 ring-white/15",
          roundClass,
          className,
        )}
        style={{ width: px, height: px, fontSize: px * 0.48 }}
        aria-hidden={!alt}
        title={alt}
      >
        ?
      </span>
    );
  }

  return (
    <span
      className={clsx(
        "relative inline-block shrink-0 overflow-hidden bg-bg-elevated ring-2 ring-white/15",
        roundClass,
        className,
      )}
      style={{ width: px, height: px }}
    >
      <Image
        src={def.src}
        alt={alt ?? def.label}
        width={px}
        height={px}
        className="h-full w-full object-cover object-top"
        unoptimized
      />
    </span>
  );
}
