import { useEffect, useRef, useState } from 'react';

const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

export function useVersionCheck() {
  const currentVersion = useRef(BUILD_ID);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const reload = () => window.location.reload();

  useEffect(() => {
    if (!import.meta.env.PROD) return;

    let cancelled = false;

    const checkVersion = async () => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const remoteVersion = data?.version as string | undefined;
        if (!remoteVersion) return;

        if (!cancelled && remoteVersion !== currentVersion.current) {
          setUpdateAvailable(true);
        }
      } catch {
        // ignore
      }
    };

    checkVersion();
    const interval = window.setInterval(checkVersion, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return { updateAvailable, reload };
}
