import { BRAND } from "@/lib/constants";
import { clsx } from "@/lib/utils";

/** Potiboo yazısıyla aynı genişlikte motto — harfler sola/sağa yayılır */
function MottoSpaced({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const chars = Array.from(text);
  return (
    <span
      className={clsx("flex w-full justify-between", className)}
      aria-label={text}
    >
      {chars.map((ch, i) => (
        <span key={`${ch}-${i}`} aria-hidden>
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  );
}

/** Potiboo: turkuaz rozet + Poti (beyaz) + boo (turkuaz) */
export function Logo({
  className,
  showWordmark = true,
  showMotto = false,
  size = "md",
}: {
  className?: string;
  showWordmark?: boolean;
  /** Marka adının altında motto (Fun, together) */
  showMotto?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const badge =
    size === "xl"
      ? "h-[3.75rem] w-[3.75rem] text-3xl rounded-[1.15rem]"
      : size === "lg"
        ? "h-12 w-12 text-2xl rounded-2xl"
        : size === "sm"
          ? "h-8 w-8 text-sm rounded-xl"
          : "h-10 w-10 text-lg rounded-2xl";

  const word =
    size === "xl"
      ? "text-[2rem] leading-none"
      : size === "lg"
        ? "text-3xl leading-none"
        : size === "sm"
          ? "text-lg leading-none"
          : "text-2xl leading-none";

  const stackH =
    size === "xl"
      ? "h-[3.75rem]"
      : size === "lg"
        ? "h-12"
        : size === "sm"
          ? "h-8"
          : "h-10";

  const motto =
    size === "xl"
      ? "text-[0.8125rem] sm:text-sm"
      : size === "lg"
        ? "text-xs"
        : "text-[0.7rem]";

  const wordmark = (
    <span className={clsx("whitespace-nowrap font-extrabold tracking-tight text-text", word)}>
      Poti<span className="text-accent">boo</span>
    </span>
  );

  return (
    <span className={clsx("inline-flex items-center gap-3", className)}>
      <span
        className={clsx(
          "relative grid shrink-0 place-items-center bg-accent shadow-lg shadow-accent/30",
          badge,
        )}
      >
        <span className="font-extrabold text-[#041018]">P</span>
        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-white ring-2 ring-bg" />
      </span>
      {showWordmark &&
        (showMotto ? (
          <span className={clsx("relative inline-block", stackH)}>
            {/* Genişliği Potiboo belirler — motto %100 bundan alır */}
            <span className="invisible block" aria-hidden>
              {wordmark}
            </span>
            <span className="absolute inset-0 flex flex-col justify-between py-0.5">
              {wordmark}
              <MottoSpaced
                text={BRAND.motto}
                className={clsx(
                  "pr-[0.22em] font-semibold leading-none text-text",
                  motto,
                )}
              />
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center">{wordmark}</span>
        ))}
    </span>
  );
}
