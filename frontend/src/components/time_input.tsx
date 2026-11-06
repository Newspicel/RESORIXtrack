// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useEffect, useState } from "preact/hooks";
import { fmtTimeOfDay, parseTimeInput, usesHour12 } from "../lib/time";

/**
 * Time-of-day input that follows the profile's time format (24-hour or 12-hour) in every browser.
 * `value`/`onChange` always use "HH:MM" (24 h); what is typed is parsed leniently on blur or Enter.
 */
export function TimeInput({ value, onChange, disabled, required, ariaLabel, id, style }: {
  value: string; onChange: (hhmm: string) => void; disabled?: boolean; required?: boolean; ariaLabel?: string; id?: string; style?: string;
}) {
  const [text, setText] = useState(value ? fmtTimeOfDay(value) : "");
  const [bad, setBad] = useState(false);
  // When the value changes from outside, show it formatted - unless the typed text already means that value.
  useEffect(() => { if (parseTimeInput(text) !== (value || null)) { setText(value ? fmtTimeOfDay(value) : ""); setBad(false); } }, [value]);
  function typed(v: string) {
    setText(v);
    // A complete time ("9:30", "09:30", "9:30 pm") is committed while typing; partial input waits for blur/Enter.
    if (/^\d{1,2}[:.]\d{2}(\s*[ap]m?)?$/i.test(v.trim())) {
      const parsed = parseTimeInput(v);
      if (parsed && parsed !== value) { setBad(false); onChange(parsed); }
    }
  }
  function commit() {
    if (!text.trim()) { setBad(!!required); if (value) onChange(""); return; }
    const parsed = parseTimeInput(text);
    if (!parsed) { setBad(true); return; }
    setBad(false);
    setText(fmtTimeOfDay(parsed));
    if (parsed !== value) onChange(parsed);
  }
  return (
    <input id={id} class="input" style={style} type="text" data-time-input="1" inputMode={usesHour12() ? "text" : "numeric"} autocomplete="off"
      placeholder={usesHour12() ? "h:mm AM" : "HH:MM"} value={text} disabled={disabled} required={required} aria-label={ariaLabel}
      aria-invalid={bad || undefined} onInput={(e) => typed((e.target as HTMLInputElement).value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
  );
}
