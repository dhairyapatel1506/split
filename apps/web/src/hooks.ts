import { useEffect } from 'react';

// Refetch on an interval, but only while the tab is visible — a background
// tab polling forever is wasted work for both the browser and the server.
export function usePoll(fn: () => void, ms: number): void {
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fn();
    }, ms);
    return () => clearInterval(id);
  }, [fn, ms]);
}
