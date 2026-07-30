"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/i18n/locale-provider";
import { PIN_LENGTH } from "@/lib/constants";
import { joinRoomByPin } from "@/lib/rooms/api";
import { isCompletePin, normalizePin } from "@/lib/rooms/pin";
import { clsx } from "@/lib/utils";

export function PinJoinForm({
  className,
  compact = false,
  autoFocus = false,
  showHeading = true,
}: {
  className?: string;
  compact?: boolean;
  autoFocus?: boolean;
  showHeading?: boolean;
}) {
  const router = useRouter();
  const { t, href } = useLocale();
  const fieldId = useId();
  const [digits, setDigits] = useState<string[]>(() =>
    Array.from({ length: PIN_LENGTH }, () => ""),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const pin = digits.join("");

  function mapJoinError(e: unknown): string {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "pin_not_found") return t("pin.notFound");
    if (msg === "pin_wrong_length") {
      return t("pin.wrongLength", { n: PIN_LENGTH });
    }
    if (msg) return msg;
    return t("common.errorGeneric");
  }

  function submit(nextPin: string) {
    const normalized = normalizePin(nextPin);
    if (!isCompletePin(normalized) || submitting.current || pending) return;
    submitting.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const room = await joinRoomByPin(normalized);
        router.push(href(`/room/${room.id}`));
      } catch (e) {
        setError(mapJoinError(e));
        submitting.current = false;
        setDigits(Array.from({ length: PIN_LENGTH }, () => ""));
        inputsRef.current[0]?.focus();
      }
    });
  }

  function applyDigits(next: string[]) {
    const clipped = next.slice(0, PIN_LENGTH);
    while (clipped.length < PIN_LENGTH) clipped.push("");
    setDigits(clipped);
    setError(null);
    const joined = clipped.join("");
    if (isCompletePin(joined)) submit(joined);
  }

  function setDigitAt(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    applyDigits(next);
    if (digit && index < PIN_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function onKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[index]) {
        const next = [...digits];
        next[index] = "";
        applyDigits(next);
        return;
      }
      if (index > 0) {
        const next = [...digits];
        next[index - 1] = "";
        applyDigits(next);
        inputsRef.current[index - 1]?.focus();
      }
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < PIN_LENGTH - 1) {
      e.preventDefault();
      inputsRef.current[index + 1]?.focus();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = normalizePin(e.clipboardData.getData("text"));
    if (!pasted) return;
    const next = Array.from({ length: PIN_LENGTH }, (_, i) => pasted[i] ?? "");
    applyDigits(next);
    const focusAt = Math.min(pasted.length, PIN_LENGTH - 1);
    inputsRef.current[focusAt]?.focus();
  }

  useEffect(() => {
    submitting.current = false;
  }, []);

  useEffect(() => {
    if (autoFocus) inputsRef.current[0]?.focus();
  }, [autoFocus]);

  return (
    <form
      className={clsx(
        compact
          ? "relative flex items-center gap-1.5"
          : "flex flex-col gap-3",
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault();
        submit(pin);
      }}
    >
      {!compact && showHeading && (
        <p className="text-center text-sm font-semibold text-text sm:text-left">
          {t("pin.heading")}
        </p>
      )}

      <div
        role="group"
        aria-label={t("pin.groupLabel")}
        className={clsx(
          "flex gap-1.5",
          !compact && "justify-center gap-2",
          compact && "sm:justify-start",
        )}
      >
        {digits.map((digit, i) => (
          <input
            key={`${fieldId}-${i}`}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            id={i === 0 ? fieldId : undefined}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            value={digit}
            placeholder=""
            aria-label={t("pin.digitLabel", { n: i + 1 })}
            onChange={(e) => setDigitAt(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={onPaste}
            onFocus={(e) => e.target.select()}
            className={clsx(
              "bg-bg-elevated text-center font-mono text-text outline-none focus:border-accent",
              compact
                ? "h-9 w-8 rounded-lg border border-border-strong bg-bg-card text-sm font-semibold"
                : "h-14 w-12 rounded-xl border-2 border-border-strong text-2xl font-bold sm:h-16 sm:w-14",
            )}
          />
        ))}
      </div>

      <input type="hidden" name="pin" value={pin} readOnly />

      <button
        type="submit"
        className={clsx(
          "btn shrink-0",
          compact
            ? "rounded-lg border border-border-strong bg-bg-card px-3 py-2 text-xs font-semibold text-text-muted hover:border-accent/50 hover:text-accent"
            : "w-full border-2 border-accent bg-transparent text-accent hover:bg-accent/15",
        )}
        disabled={pending || pin.length < PIN_LENGTH}
      >
        {pending ? t("pin.joining") : t("pin.join")}
      </button>
      {error && (
        <p
          role="alert"
          className={clsx(
            "text-sm text-danger",
            compact ? "absolute mt-10 text-xs" : "text-center",
          )}
        >
          {error}
        </p>
      )}
    </form>
  );
}
