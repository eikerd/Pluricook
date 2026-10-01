/**
 * A spreadsheet cell you type into. It commits when you leave it — Enter, Tab
 * or a click elsewhere — and only if the text changed. Enter also moves to the
 * same column one row down, Escape puts the cell back as it was.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

interface CellInputProps {
  value: string;
  /** Which column the cell is in, so Enter can find the cell below it. */
  column: string;
  label: string;
  onCommit: (text: string) => void;
  placeholder?: string;
  numeric?: boolean;
  disabled?: boolean;
}

/** The same column's cell in the next row, if there is one. */
function cellBelow(input: HTMLInputElement, column: string): HTMLInputElement | null {
  const next = input.closest("tr")?.nextElementSibling;
  return next?.querySelector<HTMLInputElement>(`input[data-column="${column}"]`) ?? null;
}

export function CellInput({ value, column, label, onCommit, placeholder, numeric, disabled }: CellInputProps) {
  const [text, setText] = useState(value);
  // Set by Escape: the blur that follows leaves the cell without saving.
  const discard = useRef(false);
  // A save answered by the server, or a re-sort, brings a new value in.
  useEffect(() => setText(value), [value]);

  // Leaving the cell is the one place it saves, so Enter (which moves focus)
  // and a click elsewhere cannot save the same edit twice.
  const onBlur = () => {
    if (discard.current) {
      discard.current = false;
      return;
    }
    if (text !== value) onCommit(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const below = cellBelow(e.currentTarget, column);
      if (below) below.focus();
      else e.currentTarget.blur();
    } else if (e.key === "Escape") {
      discard.current = true;
      setText(value);
      e.currentTarget.blur();
    }
  };

  return (
    <input
      className={`cell${numeric ? " cell--num" : ""}`}
      data-column={column}
      aria-label={label}
      value={text}
      placeholder={placeholder}
      inputMode={numeric ? "numeric" : undefined}
      disabled={disabled}
      size={Math.max(text.length, placeholder?.length ?? 0, numeric ? 3 : 6)}
      onChange={(e) => setText(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      // A cell sits in a sortable grid's row; typing in it must not open anything.
      onClick={(e) => e.stopPropagation()}
    />
  );
}
