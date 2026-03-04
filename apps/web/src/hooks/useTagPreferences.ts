import { useCallback, useEffect, useRef, useState } from "react";
import {
  createUserPreferences,
  applySignal,
  purgeStalePreferences,
  type UserTagPreference,
  type UserSignalType,
  type ContentTag
} from "@entropy/core";

const STORAGE_KEY = "entropy-tag-preferences";

function loadPreferences(): UserTagPreference[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createUserPreferences();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return createUserPreferences();
    return parsed;
  } catch {
    return createUserPreferences();
  }
}

function savePreferences(prefs: UserTagPreference[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function useTagPreferences() {
  const [preferences, setPreferences] = useState<UserTagPreference[]>(() => loadPreferences());
  const prefsRef = useRef(preferences);
  prefsRef.current = preferences;

  // Purge stale preferences on mount
  useEffect(() => {
    const purged = purgeStalePreferences(prefsRef.current);
    if (purged.length !== prefsRef.current.length) {
      setPreferences(purged);
      savePreferences(purged);
    }
  }, []);

  const recordSignal = useCallback(
    (contentTags: ContentTag[], signal: UserSignalType) => {
      const updated = applySignal(prefsRef.current, contentTags, signal);
      setPreferences(updated);
      savePreferences(updated);
    },
    []
  );

  const getPreferences = useCallback(() => prefsRef.current, []);

  return { preferences, recordSignal, getPreferences };
}
