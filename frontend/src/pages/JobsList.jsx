import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listJobs, uploadJob } from "../api/jobs.api";
import JobStatusBadge from "../components/JobStatusBadge";
import usePolling from "../hooks/usePolling";
import useJobStream from "../hooks/useJobStream";
import { formatDateTime, formatFileSize } from "../utils/format";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const PAGE_SIZE = 20;

const JobsList = () => {
    const [jobs, setJobs] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, total_pages: 1 });
    const [status_filter, setStatusFilter] = useState("");
    const [page, setPage] = useState(1);
    const [is_loading, setIsLoading] = useState(true);
    const [list_error, setListError] = useState("");
    const [selected_file, setSelectedFile] = useState(null);
    const [upload_error, setUploadError] = useState("");
    const [is_uploading, setIsUploading] = useState(false);

    const fetchJobs = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await listJobs({ status: status_filter || undefined, page, limit: PAGE_SIZE });
            setJobs(result.jobs);
            setPagination(result.pagination);
            setListError("");
        } catch (err) {
            setListError(err.response?.data?.message || "Failed to load jobs");
        } finally {
            setIsLoading(false);
        }
    }, [status_filter, page]);

    const handleStatusFilterChange = (event) => {
        setStatusFilter(event.target.value);
        setPage(1);
    };

    useEffect(() => {
        // fetch-on-mount/filter-change - no data-fetching library in this stack, see IMPLEMENTATION.md
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchJobs();
    }, [fetchJobs]);

    // SSE (ADR-5) drives near-instant updates on any of this user's job status changes
    useJobStream(() => fetchJobs());

    // documented fallback for browsers without EventSource, or if the SSE connection
    // drops silently - only bothers polling while something could still change
    usePolling(() => {
        const has_in_flight_job = jobs.some((job) => job.status === "pending" || job.status === "processing");
        if (has_in_flight_job) {
            fetchJobs();
        }
    }, 15000);

    const handleFileChange = (event) => {
        const file = event.target.files?.[0];
        setUploadError("");

        if (!file) {
            setSelectedFile(null);
            return;
        }

        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            setUploadError("Only JPG, PNG, and WEBP images are allowed");
            setSelectedFile(null);
            return;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
            setUploadError("File too large. Max size is 5MB");
            setSelectedFile(null);
            return;
        }

        setSelectedFile(file);
    };

    const handleUpload = async (event) => {
        event.preventDefault();
        if (!selected_file) {
            return;
        }

        setIsUploading(true);
        setUploadError("");

        try {
            await uploadJob(selected_file);
            setSelectedFile(null);
            event.target.reset();
            if (page === 1) {
                await fetchJobs();
            } else {
                setPage(1);
            }
        } catch (err) {
            setUploadError(err.response?.data?.message || "Upload failed");
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="jobs-page">
            <form className="upload-form" onSubmit={handleUpload}>
                <label htmlFor="image">Upload an image (JPG, PNG, WEBP — max 5MB)</label>
                <input id="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} />
                {upload_error ? <p className="form-error">{upload_error}</p> : null}
                <button type="submit" disabled={!selected_file || is_uploading}>
                    {is_uploading ? "Uploading..." : "Upload"}
                </button>
            </form>

            <div className="jobs-list-header">
                <h2>Jobs</h2>
                <select value={status_filter} onChange={handleStatusFilterChange}>
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                </select>
            </div>

            {is_loading ? <p>Loading jobs...</p> : null}
            {list_error ? <p className="form-error">{list_error}</p> : null}

            {!is_loading && jobs.length === 0 ? <p>No jobs yet — upload an image to get started.</p> : null}

            <ul className="jobs-list">
                {jobs.map((job) => (
                    <li key={job.id} className={job.result?.flagged ? "job-row job-row--flagged" : "job-row"}>
                        <Link to={`/jobs/${job.id}`}>
                            <div className="job-row-top">
                                <span className="job-filename">{job.filename}</span>
                                <JobStatusBadge status={job.status} />
                                {job.result?.flagged ? <span className="job-flagged-tag">Flagged</span> : null}
                            </div>
                            <div className="job-row-meta">
                                <span>{job.mime_type}</span>
                                <span>{formatFileSize(job.size_bytes)}</span>
                                <span>Uploaded {formatDateTime(job.created_at)}</span>
                                {job.attempts > 0 ? <span>{job.attempts} attempt{job.attempts === 1 ? "" : "s"}</span> : null}
                            </div>
                            {job.status === "failed" && job.error ? (
                                <p className="job-row-error">{job.error}</p>
                            ) : null}
                        </Link>
                    </li>
                ))}
            </ul>

            {pagination.total_pages > 1 ? (
                <div className="pager">
                    <button type="button" onClick={() => setPage((current) => current - 1)} disabled={page <= 1}>
                        Previous
                    </button>
                    <span>
                        Page {pagination.page} of {pagination.total_pages}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage((current) => current + 1)}
                        disabled={page >= pagination.total_pages}
                    >
                        Next
                    </button>
                </div>
            ) : null}
        </div>
    );
};

export default JobsList;
