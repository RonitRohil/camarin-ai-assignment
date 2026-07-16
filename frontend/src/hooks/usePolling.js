import { useCallback, useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 5000;

// GET /jobs/stream (SSE, per ADR-5) isn't built on the backend yet - this is the
// documented polling fallback in the meantime, swap for useJobStream once it lands
const usePolling = (callback, interval_ms = DEFAULT_INTERVAL_MS) => {
    const callback_ref = useRef(callback);

    useEffect(() => {
        callback_ref.current = callback;
    }, [callback]);

    useEffect(() => {
        const id = setInterval(() => callback_ref.current(), interval_ms);
        return () => clearInterval(id);
    }, [interval_ms]);

    return useCallback(() => callback_ref.current(), []);
};

export default usePolling;
