import api_client from "./client";

export const uploadJob = async (file) => {
    const form_data = new FormData();
    form_data.append("image", file);

    const { data } = await api_client.post("/jobs", form_data, {
        headers: { "Content-Type": "multipart/form-data" },
    });
    return data.result;
};

export const listJobs = async ({ status, page = 1, limit = 10 } = {}) => {
    const { data } = await api_client.get("/jobs", {
        params: { status: status || undefined, page, limit },
    });
    return data.result;
};

export const getJob = async (job_id) => {
    const { data } = await api_client.get(`/jobs/${job_id}`);
    return data.result.job;
};
