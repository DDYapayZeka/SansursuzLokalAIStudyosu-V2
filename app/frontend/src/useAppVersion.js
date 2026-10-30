import { useEffect, useState } from "react";
import { getAppVersion } from "./services/api";

// Shown until version.json has been read (or when the server cannot be reached).
export const APP_VERSION_FALLBACK = "v2";

// Installed version ("v2.0.1") read at runtime from version.json, so the UI never has to be edited
// for a release.
export function useAppVersion() {
  const [version, setVersion] = useState(APP_VERSION_FALLBACK);
  useEffect(() => {
    let mounted = true;
    getAppVersion().then((v) => {
      if (mounted && v) setVersion(v);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return version;
}
