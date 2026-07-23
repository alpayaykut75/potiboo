import { clsx } from "@/lib/utils";

/** Potiboo: turkuaz rozet + Poti (beyaz) + boo (turkuaz) */
export function Logo({
  className,
  showWordmark = true,
  size = "md",
}: {
  className?: string;
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const badge = size === "lg" ? "h-11 w-11 text-xl" : size === "sm" ? "h-8 w-8 text-sm" : "h-10 w-10 text-lg";
  const word = size === "lg" ? "text-3xl" : size === "sm" ? "text-lg" : "text-2xl";

  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <span
        className={clsx(
          "relative grid place-items-center rounded-2xl bg-accent shadow-lg shadow-accent/30",
          badge,
        )}
      >
        <span className="font-extrabold text-[#041018]">P</span>
        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-white ring-2 ring-bg" />
      </span>
      {showWordmark && (
        <span className={clsx("font-extrabold tracking-tight text-text", word)}>
          Poti<span className="text-accent">boo</span>
        </span>
      )}
    </span>
  );
}
