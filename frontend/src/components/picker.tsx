// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { t } from "../lib/i18n";
import { rankItems } from "../lib/people";
import { Icon } from "./icons";

const MAX_SHOWN = 8;

export interface PickerProps<T> {
  items: T[]; value: number | null; onChange: (id: number | null) => void;
  getId: (item: T) => number; getLabel: (item: T) => string;
  /** Extra searchable text (email, project code). */
  getSearch?: (item: T) => string | null | undefined;
  getSub?: (item: T) => ComponentChildren; renderIcon?: (item: T) => ComponentChildren;
  placeholder?: string; exclude?: number[]; ariaLabel?: string; style?: string; clearable?: boolean; id?: string;
}

/**
 * Searchable single-select (combobox): type to filter, pick with the mouse or arrow keys + Enter.
 * Scales to any list size – only the best matches are listed. Used for people and projects.
 */
export function SearchPicker<T>({ items, value, onChange, getId, getLabel, getSearch, getSub, renderIcon, placeholder, exclude, ariaLabel, style, clearable = true, id }: PickerProps<T>) {
  const listId = `${useId()}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const selected = value === null ? null : items.find((it) => getId(it) === value) || null;
  const pool = exclude?.length ? items.filter((it) => !exclude.includes(getId(it))) : items;
  const matches = rankItems(pool, query, (it) => ({ name: getLabel(it), extra: getSearch?.(it) }));
  const shown = matches.slice(0, MAX_SHOWN);
  const hidden = matches.length - shown.length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function openList() { setQuery(""); setActive(0); setOpen(true); }
  function close() { setOpen(false); setQuery(""); }
  function pick(it: T) { onChange(getId(it)); close(); }
  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(shown.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") close();
  }
  return (
    <div class="person-picker" style={style} ref={root}>
      <span class="pp-icon" aria-hidden="true"><Icon.search /></span>
      <input ref={input} id={id} class="input pp-input" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${getId(shown[active])}` : undefined} aria-label={ariaLabel}
        placeholder={open || !selected ? (placeholder || t("common.search_person")) : undefined} value={open ? query : selected ? getLabel(selected) : ""}
        autocomplete="off" spellcheck={false}
        onFocus={openList} onClick={() => !open && openList()} onKeyDown={onKey}
        onInput={(e) => { setQuery((e.target as HTMLInputElement).value); setActive(0); setOpen(true); }} />
      {selected && clearable && !open && (
        <button type="button" class="pp-clear" aria-label={t("common.clear")} onClick={() => { onChange(null); input.current?.focus(); }}><Icon.x /></button>
      )}
      {open && (
        <ul id={listId} role="listbox" class="pp-list">
          {shown.map((it, i) => {
            const sub = getSub?.(it);
            return (
              <li id={`${listId}-${getId(it)}`} key={getId(it)} role="option" aria-selected={i === active} class={i === active ? "active" : ""}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(it)}>
                {renderIcon?.(it)}
                <span class="grow pp-text"><span class="pp-name">{getLabel(it)}</span>{sub ? <span class="pp-sub">{sub}</span> : null}</span>
                {getId(it) === value && <span class="pp-check" aria-hidden="true"><Icon.check /></span>}
              </li>
            );
          })}
          {shown.length === 0 && <li class="pp-empty">{t("common.no_match", { q: query })}</li>}
          {hidden > 0 && <li class="pp-empty">{t("common.more_matches", { count: hidden })}</li>}
        </ul>
      )}
    </div>
  );
}
