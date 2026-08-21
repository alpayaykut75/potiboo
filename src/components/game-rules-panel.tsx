"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  getGameRulesMarkdown,
  parseRulesSections,
  type RulesSection,
} from "@/lib/games/rules";
import { clsx } from "@/lib/utils";

function renderInline(text: string): ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <strong key={key++} className="font-semibold text-text">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function RulesBody({ body }: { body: string }) {
  const blocks = body.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-text-muted">
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        const isList = lines.every(
          (l) => l.startsWith("- ") || /^\d+\.\s/.test(l),
        );
        if (isList) {
          const ordered = lines.every((l) => /^\d+\.\s/.test(l));
          const Tag = ordered ? "ol" : "ul";
          return (
            <Tag
              key={i}
              className={clsx(
                "space-y-1.5 pl-5",
                ordered ? "list-decimal" : "list-disc",
              )}
            >
              {lines.map((line, j) => (
                <li key={j}>
                  {renderInline(line.replace(/^(- |\d+\.\s)/, ""))}
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i} className="whitespace-pre-line">
            {lines.map((line, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                {renderInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function SectionItem({ section }: { section: RulesSection }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 py-3.5 text-left text-[16px] font-bold text-text"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {section.title}
        <span className="text-text-dim" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? (
        <div id={panelId} className="pb-4">
          <RulesBody body={section.body} />
        </div>
      ) : null}
    </div>
  );
}

export function GameRulesPanel({
  gameId,
  open,
  onClose,
}: {
  gameId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { locale, t } = useLocale();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const md = getGameRulesMarkdown(gameId, locale);
  if (!open || !md || !mounted) return null;

  const sections = parseRulesSections(md);

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex flex-col bg-black/70 pt-[var(--safe-top)] pb-[var(--safe-bottom)]"
      role="dialog"
      aria-modal="true"
      aria-label={t("play.fullRules")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex max-h-[min(92dvh,44rem)] w-full max-w-lg flex-col overflow-hidden rounded-b-3xl border border-border border-t-0 bg-bg shadow-2xl sm:mt-6 sm:rounded-3xl sm:border-t">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
          <h2 className="text-xl font-extrabold text-text">
            {t("play.fullRules")}
          </h2>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full text-2xl leading-none text-text-dim hover:bg-white/5 hover:text-text"
            onClick={onClose}
            aria-label={t("pwa.close")}
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">
          {sections.map((section) => (
            <SectionItem key={section.id} section={section} />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Oyun içi / sayfa: kurallar paneli açıcı (dosya yoksa null) */
export function GameRulesButton({
  gameId,
  className,
}: {
  gameId: string;
  className?: string;
}) {
  const { locale, t } = useLocale();
  const [open, setOpen] = useState(false);
  if (!getGameRulesMarkdown(gameId, locale)) return null;

  return (
    <>
      <button
        type="button"
        className={clsx(
          "flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-bg-card/80 text-[15px] font-bold text-text-muted transition hover:border-accent/50 hover:text-accent",
          className,
        )}
        aria-label={t("play.fullRules")}
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      <GameRulesPanel
        gameId={gameId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
