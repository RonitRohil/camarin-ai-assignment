const STATUS_LABEL = {
    pending: "Pending",
    processing: "Processing",
    completed: "Completed",
    failed: "Failed",
};

const JobStatusBadge = ({ status }) => {
    return <span className={`job-status-badge job-status-badge--${status}`}>{STATUS_LABEL[status] || status}</span>;
};

export default JobStatusBadge;
