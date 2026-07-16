import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getJob, retryJob } from "../api/jobs.api";
import JobStatusBadge from "../components/JobStatusBadge";
import FlaggedBanner from "../components/FlaggedBanner";
import usePolling from "../hooks/usePolling";
import { formatDateTime, formatFileSize, resolveImageUrl } from "../utils/format";

const IN_FLIGHT_STATUSES = ["pending", "processing"];

const JobDetail = () => {
    const { id } = useParams();
    const [job, setJob] = useState(null);
    const [error, setError] = useState("");
    const [is_loading, setIsLoading] = useState(true);
    const [is_retrying, setIsRetrying] = useState(false);
    const [retry_error, setRetryError] = useState("");

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

    const handleRetry = async () => {
        setIsRetrying(true);
        setRetryError("");
        try {
            const retried_job = await retryJob(id);
            setJob(retried_job);
        } catch (err) {
            setRetryError(err.response?.data?.message || "Retry failed");
        } finally {
            setIsRetrying(false);
        }
    };

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
    const image_src = resolveImageUrl(job.image_url);

    return (
        <div className="job-detail-page">
            <Link to="/jobs" className="back-link">
                &larr; Back to jobs
            </Link>

            <div className="job-detail-layout">
                <div className="job-detail-image">
                    {image_src ? (
                        <img src={image_src} alt={job.filename} />
                    ) : (
                        <div className="job-detail-image-placeholder">No preview available</div>
                    )}
                </div>

                <div className="job-detail-info">
                    <h1>{job.filename}</h1>

                    <div className="job-detail-status-row">
                        <JobStatusBadge status={job.status} />
                        {job.status === "failed" ? (
                            <button type="button" onClick={handleRetry} disabled={is_retrying}>
                                {is_retrying ? "Retrying..." : "Retry"}
                            </button>
                        ) : null}
                    </div>

                    {retry_error ? <p className="form-error">{retry_error}</p> : null}

                    {result?.flagged ? <FlaggedBanner category={result.flagged_category} /> : null}

                    {job.status === "failed" && job.error ? (
                        <p className="form-error">Error: {job.error}</p>
                    ) : null}

                    <dl className="job-meta">
                        <dt>Uploaded</dt>
                        <dd>{formatDateTime(job.created_at)}</dd>
                        <dt>Size</dt>
                        <dd>{formatFileSize(job.size_bytes)}</dd>
                        <dt>Type</dt>
                        <dd>{job.mime_type}</dd>
                        <dt>Attempts</dt>
                        <dd>{job.attempts}</dd>
                    </dl>
                </div>
            </div>

            {result?.caption ? (
                <section className="job-detail-section">
                    <h2>Caption</h2>
                    <p>{result.caption}</p>
                </section>
            ) : null}

            {result?.labels?.length ? (
                <section className="job-detail-section">
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
                <section className="job-detail-section">
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
