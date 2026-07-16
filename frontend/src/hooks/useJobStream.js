import { useEffect, useRef } from "react";
import { API_BASE_URL } from "../api/client";

// GET /jobs/stream (SSE, ADR-5) - one persistent connection per user, backend
// publishes { job_id, status, error? } on every job status change via Redis
// pub/sub. Browsers without EventSource just don't get called back; callers
// keep their usePolling as the documented fallback for that case.
const useJobStream = (onUpdate) => {
    const on_update_ref = useRef(onUpdate);

    useEffect(() => {
        on_update_ref.current = onUpdate;
    }, [onUpdate]);

    useEffect(() => {
        if (typeof EventSource === "undefined") {
            return undefined;
        }

        const source = new EventSource(`${API_BASE_URL}/jobs/stream`, { withCredentials: true });

        source.onmessage = (event) => {
            try {
                on_update_ref.current(JSON.parse(event.data));
            } catch {
                // malformed frame - ignore, next update will self-correct
            }
        };

        return () => source.close();
    }, []);
};

export default useJobStream;
