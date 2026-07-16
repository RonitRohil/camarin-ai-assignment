import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getJob } from "../api/jobs.api";
import JobStatusBadge from "../components/JobStatusBadge";
import FlaggedBanner from "../components/FlaggedBanner";
import usePolling from "../hooks/usePolling";

const IN_FLIGHT_STATUSES = ["pending", "processing"];

const JobDetail = () => {
    const { id } = useParams();
    const [job, setJob] = useState(null);
    const [error, setError] = useState("");
    const [is_loading, setIsLoading] = useState(true);

    const fetchJob = useCallback(async () => {
        setIsLoading(true);
        try {
            const fetched_job = await getJob(id);
            setJob(fetched_job);
            setError("");
        } catch (err) {
            setError(err.response?.data?.message || "Failed to load job");
        } finally {
            setIsLoading(false);
        }
    }, [id]);

    useEffect(() => {
        // fetch-on-mount/id-change - no data-fetching library in this stack, see IMPLEMENTATION.md
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchJob();
    }, [fetchJob]);

    usePolling(() => {
        if (job && IN_FLIGHT_STATUSES.includes(job.status)) {
            fetchJob();
        }
    }, 5000);

    if (is_loading) {
        return <p>Loading job...</p>;
    }

    if (error) {
        return <p className="form-error">{error}</p>;
    }

    if (!job) {
        return null;
    }

    const result = job.result;

    return (
        <div className="job-detail-page">
            <Link to="/jobs">&larr; Back to jobs</Link>

            <h1>{job.filename}</h1>
            <JobStatusBadge status={job.status} />

            {result?.flagged ? <FlaggedBanner category={result.flagged_category} /> : null}

            {job.status === "failed" && job.error ? <p className="form-error">Error: {job.error}</p> : null}

            {job.status === "failed" ? (
                <p className="retry-note">
                    Retry isn't wired up yet — the backend's <code>POST /jobs/:id/retry</code> endpoint is still being built.
                </p>
            ) : null}

            <dl className="job-meta">
                <dt>Uploaded</dt>
                <dd>{new Date(job.created_at).toLocaleString()}</dd>
                <dt>Size</dt>
                <dd>{(job.size_bytes / 1024).toFixed(1)} KB</dd>
                <dt>Type</dt>
                <dd>{job.mime_type}</dd>
                <dt>Attempts</dt>
                <dd>{job.attempts}</dd>
            </dl>

            {result?.caption ? (
                <section>
                    <h2>Caption</h2>
                    <p>{result.caption}</p>
                </section>
            ) : null}

            {result?.labels?.length ? (
                <section>
                    <h2>Labels</h2>
                    <ul className="labels-list">
                        {result.labels.map((label) => (
                            <li key={label.description}>
                                {label.description} — {(label.score * 100).toFixed(0)}%
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            {result?.safe_search ? (
                <section>
                    <h2>Safety classification</h2>
                    <dl className="safe-search-list">
                        {Object.entries(result.safe_search).map(([category, likelihood]) => (
                            <div key={category}>
                                <dt>{category}</dt>
                                <dd>{likelihood}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            ) : null}
        </div>
    );
};

export default JobDetail;
