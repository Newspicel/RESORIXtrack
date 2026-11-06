// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { t } from "../lib/i18n";
import type { Person } from "../lib/people";
import { SearchPicker } from "./picker";
import { Avatar } from "./ui";

export type { Person };

/** Searchable person picker: type a name or email. Pass `placeholder` for filters ("All people"). */
export function PersonPicker({ people, value, onChange, placeholder, exclude, meId, ariaLabel, style, clearable = true, id }: {
  people: Person[]; value: number | null; onChange: (id: number | null) => void; placeholder?: string; exclude?: number[];
  meId?: number; ariaLabel?: string; style?: string; clearable?: boolean; id?: string;
}) {
  return (
    <SearchPicker items={people} value={value} onChange={onChange} getId={(p) => p.id}
      getLabel={(p) => (p.id === meId ? `${p.name} (${t("common.you")})` : p.name)} getSearch={(p) => p.email}
      getSub={(p) => p.team_name || p.email || null} renderIcon={(p) => <Avatar name={p.name} size="sm" />}
      placeholder={placeholder} exclude={exclude} ariaLabel={ariaLabel} style={style} clearable={clearable} id={id} />
  );
}
