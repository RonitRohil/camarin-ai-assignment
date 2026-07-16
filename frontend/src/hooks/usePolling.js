import { useCallback, useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 5000;

// documented fallback for when SSE (useJobStream, per ADR-5) is unavailable
// or drops - callers use useJobStream as primary and this as backup
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
