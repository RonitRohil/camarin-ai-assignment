const { Redis } = require("ioredis");
const env = require("../config/env");

const CHANNEL_PREFIX = "job-updates:";
const getChannelName = (user_id) => `${CHANNEL_PREFIX}${user_id}`;

// lazy singletons - the API process only ever subscribes (serves SSE to
// browsers), the worker process only ever publishes (from runPipeline.js).
// Creating connections on first use instead of at module load means neither
// process opens a Redis connection it doesn't actually need.
let publisher = null;
const getPublisher = () => {
    if (!publisher) {
        publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    }
    return publisher;
};

let subscriber = null;
const channel_listeners = new Map();

const getSubscriber = () => {
    if (!subscriber) {
        subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
        subscriber.on("message", (channel, message) => {
            const listeners = channel_listeners.get(channel);
            if (!listeners) return;

            for (const res of listeners) {
                res.write(`data: ${message}\n\n`);
            }
        });
    }
    return subscriber;
};

const publishJobUpdate = async (user_id, payload) => {
    await getPublisher().publish(getChannelName(user_id), JSON.stringify(payload));
};

// registers `res` (an SSE response stream) to receive updates for this user;
// returns an unsubscribe function to call when the client disconnects
const subscribeUser = (user_id, res) => {
    const subscriber_conn = getSubscriber();
    const channel = getChannelName(user_id);

    if (!channel_listeners.has(channel)) {
        channel_listeners.set(channel, new Set());
        subscriber_conn.subscribe(channel);
    }

    channel_listeners.get(channel).add(res);

    return () => {
        const listeners = channel_listeners.get(channel);
        if (!listeners) return;

        listeners.delete(res);

        if (listeners.size === 0) {
            channel_listeners.delete(channel);
            subscriber_conn.unsubscribe(channel);
        }
    };
};

module.exports = { publishJobUpdate, subscribeUser };
