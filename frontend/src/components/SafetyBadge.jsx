const LIKELIHOOD = {
    VERY_UNLIKELY: { label: "Very unlikely", tier: "safe" },
    UNLIKELY: { label: "Unlikely", tier: "safe" },
    POSSIBLE: { label: "Possible", tier: "caution" },
    LIKELY: { label: "Likely", tier: "flagged" },
    VERY_LIKELY: { label: "Very likely", tier: "flagged" },
    UNKNOWN: { label: "Unknown", tier: "unknown" },
};

const SafetyBadge = ({ likelihood }) => {
    const { label, tier } = LIKELIHOOD[likelihood] || { label: likelihood, tier: "unknown" };
    return <span className={`safety-badge safety-badge--${tier}`}>{label}</span>;
};

export default SafetyBadge;
