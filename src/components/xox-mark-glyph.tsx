"use client";

import { clsx } from "@/lib/utils";

/** Optik dengeli ✕ / ◯ — kalın stroke, ◯ ~%88 ölçek */
export function XoxMarkGlyph({
  mark,
  color,
  size = 28,
  className,
}: {
  mark: "X" | "O";
  color: string;
  /** Kutu boyutu (px); sembol kutunun içinde ortalanır */
  size?: number;
  className?: string;
}) {
  const stroke = Math.max(2.4, size * 0.11);
  // ◯ kapalı form olduğu için optik olarak büyük; ~%88
  const circleScale = 0.88;
  const pad = size * 0.18;

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        className="block"
      >
        {mark === "X" ? (
          <>
            <line
              x1={pad}
              y1={pad}
              x2={size - pad}
              y2={size - pad}
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
            />
            <line
              x1={size - pad}
              y1={pad}
              x2={pad}
              y2={size - pad}
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
            />
          </>
        ) : (
          <g
            transform={`translate(${size / 2}, ${size / 2}) scale(${circleScale}) translate(${-size / 2}, ${-size / 2})`}
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={(size - pad * 2) / 2}
              stroke={color}
              strokeWidth={stroke / circleScale}
              fill="none"
            />
          </g>
        )}
      </svg>
    </span>
  );
}
